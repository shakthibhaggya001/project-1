/*
# Post-Submission Stats Function

## Overview
Adds an RPC function that lets students see their results immediately after submitting,
before the admin officially generates/publishes results. It scores the student's answers
on the fly and computes their rank against all other submissions.

## New Function

### get_post_submission_stats(p_quiz_id, p_student_name, p_student_identifier)
- SECURITY DEFINER (callable by anon, bypasses RLS to read all submissions)
- Scores the calling student's submission by comparing answers to correct answers
- Computes total participants, highest score, and the student's rank
- Rank = 1 + count of submissions with a higher score (ties share the same rank)
- Returns: student_score, total_participants, highest_score, student_rank, total_questions
- Does NOT modify any data — purely read-only

## Security
- Callable by anon and authenticated (students aren't signed in)
- Read-only — no writes to any table
*/

CREATE OR REPLACE FUNCTION get_post_submission_stats(
  p_quiz_id uuid,
  p_student_name text,
  p_student_identifier text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_score int;
  v_total_participants int;
  v_highest_score int;
  v_student_rank int;
  v_total_questions int;
  v_student_answers jsonb;
BEGIN
  -- Get the student's answers
  SELECT answers INTO v_student_answers
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_name = p_student_name
    AND student_identifier = COALESCE(p_student_identifier, '');

  IF v_student_answers IS NULL THEN
    RETURN jsonb_build_object('error', 'No submission found');
  END IF;

  -- Score the student
  SELECT count(*)::int INTO v_student_score
  FROM questions q
  WHERE q.quiz_id = p_quiz_id
    AND upper(q.correct_answer::text) = upper(
      COALESCE(v_student_answers ->> q.question_number::text, '')
    );

  -- Total questions
  SELECT count(*)::int INTO v_total_questions
  FROM questions WHERE quiz_id = p_quiz_id;

  -- Total participants
  SELECT count(*)::int INTO v_total_participants
  FROM submissions WHERE quiz_id = p_quiz_id;

  -- Highest score among all submissions (computed on the fly)
  WITH all_scores AS (
    SELECT s.answers,
           (
             SELECT count(*)::int
             FROM questions q
             WHERE q.quiz_id = s.quiz_id
               AND upper(q.correct_answer::text) = upper(
                 COALESCE(s.answers ->> q.question_number::text, '')
               )
           ) AS calc_score
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
  )
  SELECT COALESCE(max(calc_score), 0) INTO v_highest_score FROM all_scores;

  -- Student rank: 1 + number of submissions with a strictly higher score
  WITH all_scores AS (
    SELECT s.answers,
           (
             SELECT count(*)::int
             FROM questions q
             WHERE q.quiz_id = s.quiz_id
               AND upper(q.correct_answer::text) = upper(
                 COALESCE(s.answers ->> q.question_number::text, '')
               )
           ) AS calc_score
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
  )
  SELECT count(*)::int + 1 INTO v_student_rank
  FROM all_scores
  WHERE calc_score > v_student_score;

  RETURN jsonb_build_object(
    'student_score', v_student_score,
    'total_participants', v_total_participants,
    'highest_score', v_highest_score,
    'student_rank', v_student_rank,
    'total_questions', v_total_questions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_post_submission_stats(uuid, text, text) TO anon, authenticated;
