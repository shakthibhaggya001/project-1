/*
# Quiz Platform Schema

## Overview
Creates the full schema for a weekly timed MCQ quiz competition platform.
Students join without signing in (just name + optional ID), take a timed quiz,
and get auto-ranked. Admins sign in with email/password to create quizzes,
enter questions, monitor live submissions, and generate results.

## New Tables

### quizzes
- `id` (uuid, PK) — unique quiz identifier
- `title` (text) — quiz title shown to students
- `description` (text) — optional description
- `quiz_date` (date) — the date the quiz is scheduled for
- `start_time` (timestamptz) — when the quiz window opens
- `end_time` (timestamptz) — when the quiz window closes
- `results_published` (boolean, default false) — set true after admin generates results
- `created_at` (timestamptz) — creation timestamp

### questions
- `id` (uuid, PK)
- `quiz_id` (uuid, FK → quizzes) — which quiz this question belongs to
- `question_number` (int) — 1-based ordering
- `question_text` (text) — the question
- `option_a` (text) — option A text
- `option_b` (text) — option B text
- `option_c` (text) — option C text
- `option_d` (text) — option D text
- `correct_answer` (char(1)) — 'A', 'B', 'C', or 'D'

### submissions
- `id` (uuid, PK)
- `quiz_id` (uuid, FK → quizzes)
- `student_name` (text) — student's display name
- `student_identifier` (text, default '') — student ID or phone (optional, defaults to empty)
- `answers` (jsonb) — map of question_number → selected option letter
- `score` (int, default 0) — number of correct answers
- `rank` (int, nullable) — 1-based rank, assigned during result generation
- `started_at` (timestamptz) — when the student started the quiz
- `submitted_at` (timestamptz) — when the student submitted (manual or auto)
- `time_taken_seconds` (int, nullable) — seconds from start to submit
- `created_at` (timestamptz) — row creation time
- Unique constraint on (quiz_id, student_name, student_identifier) to prevent duplicate submissions

## RPC Functions

### generate_quiz_results(p_quiz_id uuid)
- SECURITY DEFINER (runs with owner privileges so it can update all submissions)
- Scores every submission by comparing answers to correct answers
- Assigns rank using RANK() ordered by score DESC, submitted_at ASC (ties broken by earlier submission)
- Computes time_taken_seconds from started_at to submitted_at
- Sets results_published = true on the quiz
- Returns a summary (total_participants, top_score, etc.)

### get_student_result(p_quiz_id uuid, p_student_name text, p_student_identifier text)
- SECURITY DEFINER (callable by anon, returns only the matching student's data)
- Returns the student's score, rank, total participants, and top_50 status
- Only returns data if results are published

## Security
- RLS enabled on all tables.
- quizzes/questions: SELECT open to anon+authenticated (students read them); writes to authenticated only (admin).
- submissions: INSERT open to anon+authenticated (students submit); SELECT/UPDATE to authenticated only (admin).
- RPC functions are SECURITY DEFINER so they bypass RLS where needed.
*/

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  quiz_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  results_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_number int NOT NULL,
  question_text text NOT NULL,
  option_a text NOT NULL,
  option_b text NOT NULL,
  option_c text NOT NULL,
  option_d text NOT NULL,
  correct_answer char(1) NOT NULL CHECK (correct_answer IN ('A','B','C','D'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_identifier text NOT NULL DEFAULT '',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score int NOT NULL DEFAULT 0,
  rank int,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  time_taken_seconds int,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_submission UNIQUE (quiz_id, student_name, student_identifier)
);

-- Indexes for performance at scale
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id_qnum ON questions(quiz_id, question_number);
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_id ON submissions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_id_rank ON submissions(quiz_id, rank);
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_id_score ON submissions(quiz_id, score DESC);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- quizzes: students (anon) can read; admin (authenticated) can write
DROP POLICY IF EXISTS "read_quizzes" ON quizzes;
CREATE POLICY "read_quizzes" ON quizzes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_quizzes" ON quizzes;
CREATE POLICY "insert_quizzes" ON quizzes FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_quizzes" ON quizzes;
CREATE POLICY "update_quizzes" ON quizzes FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_quizzes" ON quizzes;
CREATE POLICY "delete_quizzes" ON quizzes FOR DELETE
  TO authenticated USING (true);

-- questions: students (anon) can read; admin (authenticated) can write
DROP POLICY IF EXISTS "read_questions" ON questions;
CREATE POLICY "read_questions" ON questions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_questions" ON questions;
CREATE POLICY "insert_questions" ON questions FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_questions" ON questions;
CREATE POLICY "update_questions" ON questions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_questions" ON questions;
CREATE POLICY "delete_questions" ON questions FOR DELETE
  TO authenticated USING (true);

-- submissions: students (anon) can insert; admin (authenticated) can read/update
DROP POLICY IF EXISTS "insert_submissions" ON submissions;
CREATE POLICY "insert_submissions" ON submissions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "read_submissions" ON submissions;
CREATE POLICY "read_submissions" ON submissions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "update_submissions" ON submissions;
CREATE POLICY "update_submissions" ON submissions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_submissions" ON submissions;
CREATE POLICY "delete_submissions" ON submissions FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- RPC: generate_quiz_results
-- Scores all submissions, assigns ranks, marks results published
-- ============================================================

CREATE OR REPLACE FUNCTION generate_quiz_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_top_score int;
  v_quiz_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM quizzes WHERE id = p_quiz_id) INTO v_quiz_exists;
  IF NOT v_quiz_exists THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  -- Score each submission by comparing answers to correct answers
  WITH scored AS (
    SELECT s.id,
           (
             SELECT count(*)::int
             FROM questions q
             WHERE q.quiz_id = s.quiz_id
               AND upper(q.correct_answer::text) = upper(
                 COALESCE(
                   (s.answers ->> q.question_number::text),
                   ''
                 )
               )
           ) AS calc_score
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
  ),
  ranked AS (
    SELECT scored.id,
           scored.calc_score,
           RANK() OVER (
             ORDER BY scored.calc_score DESC,
             (SELECT s2.submitted_at FROM submissions s2 WHERE s2.id = scored.id) ASC
           ) AS calc_rank
    FROM scored
  )
  UPDATE submissions
  SET score = ranked.calc_score,
      rank = ranked.calc_rank,
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (submitted_at - started_at))::int)
  FROM ranked
  WHERE submissions.id = ranked.id;

  -- Mark results as published
  UPDATE quizzes SET results_published = true WHERE id = p_quiz_id;

  SELECT count(*)::int INTO v_total FROM submissions WHERE quiz_id = p_quiz_id;
  SELECT COALESCE(max(score), 0) INTO v_top_score FROM submissions WHERE quiz_id = p_quiz_id;

  RETURN jsonb_build_object(
    'total_participants', v_total,
    'top_score', v_top_score,
    'quiz_id', p_quiz_id
  );
END;
$$;

-- ============================================================
-- RPC: get_student_result
-- Returns a single student's result (score, rank, total, top_50)
-- Only returns data if results are published
-- ============================================================

CREATE OR REPLACE FUNCTION get_student_result(
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
  v_published boolean;
  v_result jsonb;
BEGIN
  SELECT results_published INTO v_published FROM quizzes WHERE id = p_quiz_id;
  IF v_published IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  IF NOT v_published THEN
    RETURN jsonb_build_object('error', 'Results not published yet');
  END IF;

  SELECT jsonb_build_object(
    'score', s.score,
    'rank', s.rank,
    'total_participants', (SELECT count(*)::int FROM submissions WHERE quiz_id = p_quiz_id),
    'in_top_50', (s.rank IS NOT NULL AND s.rank <= 50),
    'time_taken_seconds', s.time_taken_seconds,
    'student_name', s.student_name,
    'submitted_at', s.submitted_at
  ) INTO v_result
  FROM submissions s
  WHERE s.quiz_id = p_quiz_id
    AND s.student_name = p_student_name
    AND s.student_identifier = COALESCE(p_student_identifier, '');

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'No submission found for that name and ID');
  END IF;

  RETURN v_result;
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION generate_quiz_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_student_result(uuid, text, text) TO anon, authenticated;
