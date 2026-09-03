/*
# Add student detail fields to submissions

## Overview
Adds grade, school_name, and whatsapp_number columns to the submissions table
so students provide their details before starting a quiz.

## Changes
- submissions: + grade (int), school_name (text), whatsapp_number (text)
- Updates get_post_submission_stats to no longer return total_participants
  (privacy: total student count should not be visible to other students)
*/

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grade int;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS school_name text DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS whatsapp_number text DEFAULT '';

-- Update the unique constraint to include whatsapp_number for better dedup
-- (a student is uniquely identified by name + whatsapp within a quiz)
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS unique_submission;
ALTER TABLE submissions ADD CONSTRAINT unique_submission UNIQUE (quiz_id, student_name, whatsapp_number);

-- ============================================================
-- Update get_post_submission_stats: remove total_participants for privacy
-- Students should only see their own rank, not how many others participated
-- ============================================================

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
  v_highest_score int;
  v_student_rank int;
  v_total_questions int;
  v_student_answers jsonb;
BEGIN
  -- Get the student's answers (match by name + whatsapp_number or name + identifier)
  SELECT answers INTO v_student_answers
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_name = p_student_name
    AND (
      whatsapp_number = COALESCE(p_student_identifier, '')
      OR student_identifier = COALESCE(p_student_identifier, '')
    )
  LIMIT 1;

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
    'highest_score', v_highest_score,
    'student_rank', v_student_rank,
    'total_questions', v_total_questions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_post_submission_stats(uuid, text, text) TO anon, authenticated;
