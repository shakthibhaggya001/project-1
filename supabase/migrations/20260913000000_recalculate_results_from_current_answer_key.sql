-- Re-score submitted attempts from the answer key currently stored on questions.
-- Student answers remain unchanged; question_snapshot is retained for historical display only.

CREATE OR REPLACE FUNCTION public.generate_quiz_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_participants int;
  top_score int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  WITH scored AS (
    SELECT s.id,
      (
        SELECT count(*)::int
        FROM questions q
        WHERE q.quiz_id = s.quiz_id
          AND upper(q.correct_answer::text) = upper(COALESCE(s.answers ->> q.question_number::text, ''))
      ) AS score,
      s.submitted_at
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
      AND s.status = 'submitted'
  ), ranked AS (
    SELECT id, score, rank() OVER (ORDER BY score DESC, submitted_at ASC) AS result_rank
    FROM scored
  )
  UPDATE submissions s
  SET score = ranked.score,
      rank = ranked.result_rank
  FROM ranked
  WHERE s.id = ranked.id;

  UPDATE submissions
  SET rank = NULL
  WHERE quiz_id = p_quiz_id
    AND status <> 'submitted';

  UPDATE quizzes
  SET results_generated = true,
      results_confirmed = false,
      results_published = false
  WHERE id = p_quiz_id;

  SELECT count(*)::int
  INTO total_participants
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND status = 'submitted';

  SELECT COALESCE(max(score), 0)
  INTO top_score
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND status = 'submitted';

  RETURN jsonb_build_object(
    'total_participants', total_participants,
    'top_score', top_score,
    'quiz_id', p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_quiz_results(uuid) TO authenticated;