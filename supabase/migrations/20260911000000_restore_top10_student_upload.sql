-- Restore the student-facing Top 10 photo upload token in published results.

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
BEGIN
  SELECT results_published INTO published FROM quizzes WHERE id = p_quiz_id;
  IF published IS NULL THEN RETURN jsonb_build_object('error', 'Quiz not found'); END IF;
  IF NOT published THEN RETURN jsonb_build_object('error', 'Results have not been published yet'); END IF;

  SELECT * INTO submission_row FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g')
    AND lower(trim(student_name)) = lower(trim(p_student_name))
    AND status = 'submitted'
  LIMIT 1;

  IF submission_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unable to find a published result with these details');
  END IF;

  SELECT count(*)::int INTO total_questions FROM questions WHERE quiz_id = p_quiz_id;
  SELECT count(*)::int INTO total_participants FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';
  SELECT count(*)::int INTO answered FROM jsonb_object_keys(COALESCE(submission_row.answers, '{}'::jsonb));
  unanswered := GREATEST(total_questions - answered, 0);

  RETURN jsonb_build_object(
    'submission_id', submission_row.id,
    'score', submission_row.score,
    'rank', submission_row.rank,
    'total_participants', total_participants,
    'total_questions', total_questions,
    'correct', submission_row.score,
    'incorrect', GREATEST(total_questions - submission_row.score - unanswered, 0),
    'unanswered', unanswered,
    'percentage', round((submission_row.score::numeric / greatest(total_questions, 1)) * 100, 1),
    'student_name', submission_row.student_name,
    'school_name', submission_row.school_name,
    'grade', submission_row.grade,
    'is_top_10', (submission_row.rank IS NOT NULL AND submission_row.rank <= 10),
    'photo_url', COALESCE(submission_row.photo_url, ''),
    'time_taken_seconds', submission_row.time_taken_seconds,
    'submitted_at', submission_row.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_result(uuid, text, text)
TO anon, authenticated;
