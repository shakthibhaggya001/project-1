-- Enforce attempt status and exam deadlines on the server.

CREATE OR REPLACE FUNCTION public.save_answer_progress(
  p_submission_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submission_row submissions%ROWTYPE;
  quiz_end timestamptz;
BEGIN
  SELECT * INTO submission_row FROM submissions WHERE id = p_submission_id;
  IF submission_row.id IS NULL THEN RETURN jsonb_build_object('error', 'Submission not found'); END IF;
  IF submission_row.status NOT IN ('in_progress', 'interrupted') THEN
    RETURN jsonb_build_object('error', 'This attempt is no longer active');
  END IF;
  SELECT end_time INTO quiz_end FROM quizzes WHERE id = submission_row.quiz_id;
  IF now() > COALESCE(submission_row.time_extension_until, quiz_end) THEN
    UPDATE submissions SET status = 'expired', last_activity_at = now() WHERE id = p_submission_id;
    RETURN jsonb_build_object('error', 'expired', 'message', 'This attempt has expired.');
  END IF;
  UPDATE submissions
  SET answers = COALESCE(p_answers, '{}'::jsonb), last_activity_at = now()
  WHERE id = p_submission_id;
  RETURN jsonb_build_object('ok', true, 'message', 'Progress saved');
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_answer_progress(uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_exam(
  p_submission_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submission_row submissions%ROWTYPE;
  quiz_end timestamptz;
  snapshot jsonb;
BEGIN
  SELECT * INTO submission_row FROM submissions WHERE id = p_submission_id;
  IF submission_row.id IS NULL THEN RETURN jsonb_build_object('error', 'Submission not found'); END IF;
  IF submission_row.status = 'submitted' THEN RETURN jsonb_build_object('ok', true, 'message', 'Already submitted'); END IF;
  IF submission_row.status = 'expired' THEN RETURN jsonb_build_object('error', 'expired', 'message', 'This attempt has expired.'); END IF;
  SELECT end_time INTO quiz_end FROM quizzes WHERE id = submission_row.quiz_id;
  IF now() > COALESCE(submission_row.time_extension_until, quiz_end) THEN
    UPDATE submissions SET status = 'expired', last_activity_at = now() WHERE id = p_submission_id;
    RETURN jsonb_build_object('error', 'expired', 'message', 'This attempt has expired.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'question_number', q.question_number, 'question_text', q.question_text,
    'option_a', q.option_a, 'option_b', q.option_b, 'option_c', q.option_c,
    'option_d', q.option_d, 'correct_answer', q.correct_answer, 'marks', 1
  ) ORDER BY q.question_number)
  INTO snapshot
  FROM questions q WHERE q.quiz_id = submission_row.quiz_id;

  UPDATE submissions
  SET answers = COALESCE(p_answers, '{}'::jsonb), status = 'submitted', submitted_at = now(),
      last_activity_at = now(), question_snapshot = COALESCE(snapshot, '[]'::jsonb),
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(attempt_started_at, started_at)))::int)
  WHERE id = p_submission_id;
  RETURN jsonb_build_object('ok', true, 'message', 'Exam submitted successfully');
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid, jsonb) TO anon, authenticated;
