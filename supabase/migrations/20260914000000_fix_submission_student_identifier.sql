-- Keep the denormalized submission identifier synchronized with the canonical
-- student identity and allow published-result lookup to recover legacy rows.

CREATE OR REPLACE FUNCTION public.sync_submission_student_identifier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.student_id IS NOT NULL THEN
    SELECT st.whatsapp_number
    INTO NEW.student_identifier
    FROM public.students st
    WHERE st.id = NEW.student_id;

    IF NEW.student_identifier IS NOT NULL AND NEW.student_identifier <> '' THEN
      NEW.whatsapp_number := NEW.student_identifier;
      NEW.normalized_whatsapp := regexp_replace(NEW.student_identifier, '[^0-9]', '', 'g');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_submission_student_identifier_trigger ON public.submissions;
CREATE TRIGGER sync_submission_student_identifier_trigger
  BEFORE INSERT OR UPDATE OF student_id ON public.submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_submission_student_identifier();

-- The active attempt-start RPC resolves the student first, then inserts the
-- submission. Set the identifier explicitly from that canonical row.
CREATE OR REPLACE FUNCTION public.start_or_resume_attempt(
  p_quiz_id uuid,
  p_student_name text,
  p_whatsapp_number text,
  p_grade int DEFAULT NULL,
  p_school_name text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz quizzes%ROWTYPE;
  v_now timestamptz;
  v_normalized_whatsapp text;
  v_normalized_name text;
  v_student_id uuid;
  v_student students%ROWTYPE;
  v_existing submissions%ROWTYPE;
  v_effective_end timestamptz;
BEGIN
  SELECT * INTO v_quiz FROM quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  v_now := now();
  IF v_now < v_quiz.start_time THEN
    RETURN jsonb_build_object('error', 'before_start', 'server_time', v_now, 'start_time', v_quiz.start_time,
      'end_time', v_quiz.end_time, 'message', 'Exam has not started yet');
  END IF;
  IF v_now > v_quiz.end_time THEN
    RETURN jsonb_build_object('error', 'after_end', 'server_time', v_now, 'end_time', v_quiz.end_time,
      'message', 'Exam window has closed');
  END IF;

  v_normalized_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');
  v_normalized_name := upper(trim(p_student_name));
  IF v_normalized_whatsapp = '' THEN
    RETURN jsonb_build_object('error', 'invalid_phone', 'message', 'A valid WhatsApp number is required');
  END IF;
  IF v_normalized_name = '' THEN
    RETURN jsonb_build_object('error', 'invalid_name', 'message', 'Name is required');
  END IF;

  v_student_id := get_or_create_student(p_student_name, p_whatsapp_number, p_grade, p_school_name);
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('error', 'identity_failed', 'message', 'Failed to establish student identity');
  END IF;

  SELECT * INTO v_student FROM students WHERE id = v_student_id;
  IF NOT FOUND OR NULLIF(trim(v_student.whatsapp_number), '') IS NULL THEN
    RETURN jsonb_build_object('error', 'identity_failed', 'message', 'Student WhatsApp number is missing');
  END IF;

  SELECT * INTO v_existing
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND (student_id = v_student_id OR normalized_whatsapp = v_normalized_whatsapp)
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'submitted' THEN
      RETURN jsonb_build_object('error', 'already_submitted', 'message', 'You have already attempted this examination.');
    ELSIF v_existing.status = 'expired' THEN
      RETURN jsonb_build_object('error', 'expired', 'message', 'This examination attempt has expired.');
    ELSIF v_existing.status IN ('in_progress', 'interrupted') THEN
      v_effective_end := COALESCE(v_existing.time_extension_until, v_quiz.end_time);
      IF v_existing.resume_allowed OR v_now <= v_effective_end THEN
        IF v_existing.status = 'interrupted' THEN
          UPDATE submissions SET status = 'in_progress' WHERE id = v_existing.id;
        END IF;
        RETURN jsonb_build_object(
          'ok', true, 'action', 'resume', 'submission_id', v_existing.id, 'student_id', v_student_id,
          'server_time', v_now, 'start_time', v_quiz.start_time, 'end_time', v_quiz.end_time,
          'effective_end_time', v_effective_end,
          'attempt_started_at', COALESCE(v_existing.attempt_started_at, v_existing.started_at),
          'saved_answers', v_existing.answers, 'message', 'Resuming your previous attempt.'
        );
      END IF;
      RETURN jsonb_build_object(
        'error', 'resume_not_allowed',
        'message', 'Your previous examination attempt cannot be resumed.'
      );
    END IF;
  END IF;

  INSERT INTO submissions (
    quiz_id, student_id, student_name, student_identifier, whatsapp_number, grade, school_name,
    answers, started_at, submitted_at, status, attempt_started_at, last_activity_at,
    normalized_name, normalized_whatsapp
  ) VALUES (
    p_quiz_id, v_student.id, p_student_name, v_student.whatsapp_number, v_student.whatsapp_number, p_grade,
    p_school_name, '{}'::jsonb, v_now, v_now, 'in_progress', v_now, v_now,
    v_normalized_name, regexp_replace(v_student.whatsapp_number, '[^0-9]', '', 'g')
  )
  RETURNING id INTO v_existing.id;

  RETURN jsonb_build_object(
    'ok', true, 'action', 'new', 'submission_id', v_existing.id, 'student_id', v_student.id,
    'server_time', v_now, 'start_time', v_quiz.start_time, 'end_time', v_quiz.end_time,
    'effective_end_time', v_quiz.end_time, 'attempt_started_at', v_now, 'message', 'Exam started.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_or_resume_attempt(uuid, text, text, int, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_student_result(
  p_quiz_id uuid,
  p_student_name text,
  p_whatsapp_number text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submission_row submissions%ROWTYPE;
  published boolean;
  total_questions int;
  total_participants int;
  answered int;
  unanswered int;
  requested_whatsapp text := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');
BEGIN
  SELECT results_published INTO published FROM quizzes WHERE id = p_quiz_id;
  IF published IS NULL THEN RETURN jsonb_build_object('error', 'Quiz not found'); END IF;
  IF NOT published THEN RETURN jsonb_build_object('error', 'Results have not been published yet'); END IF;

  SELECT s.* INTO submission_row
  FROM submissions s
  LEFT JOIN students st ON st.id = s.student_id
  WHERE s.quiz_id = p_quiz_id
    AND lower(trim(s.student_name)) = lower(trim(p_student_name))
    AND s.status = 'submitted'
    AND (
      regexp_replace(COALESCE(s.normalized_whatsapp, ''), '[^0-9]', '', 'g') = requested_whatsapp
      OR regexp_replace(COALESCE(NULLIF(trim(s.student_identifier), ''), ''), '[^0-9]', '', 'g') = requested_whatsapp
      OR regexp_replace(COALESCE(st.normalized_whatsapp, st.whatsapp_number, ''), '[^0-9]', '', 'g') = requested_whatsapp
    )
  LIMIT 1;

  IF submission_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unable to find a published result with these details');
  END IF;

  SELECT count(*)::int INTO total_questions FROM questions WHERE quiz_id = p_quiz_id;
  SELECT count(*)::int INTO total_participants FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';
  SELECT count(*)::int INTO answered FROM jsonb_object_keys(COALESCE(submission_row.answers, '{}'::jsonb));
  unanswered := GREATEST(total_questions - answered, 0);

  RETURN jsonb_build_object(
    'submission_id', submission_row.id, 'score', submission_row.score, 'rank', submission_row.rank,
    'total_participants', total_participants, 'total_questions', total_questions,
    'correct', submission_row.score, 'incorrect', GREATEST(total_questions - submission_row.score - unanswered, 0),
    'unanswered', unanswered, 'percentage', round((submission_row.score::numeric / greatest(total_questions, 1)) * 100, 1),
    'student_name', submission_row.student_name, 'school_name', submission_row.school_name,
    'grade', submission_row.grade, 'is_top_10', (submission_row.rank IS NOT NULL AND submission_row.rank <= 10),
    'photo_url', COALESCE(submission_row.photo_url, ''), 'time_taken_seconds', submission_row.time_taken_seconds,
    'submitted_at', submission_row.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_result(uuid, text, text) TO anon, authenticated;