/*
# Admin Paper Management & Question Snapshot Protection

## Overview
Adds support for permanent admin paper management: question-level timestamps,
a duplicate-paper RPC function, and question snapshots stored with each submission
to protect historical results from being corrupted by later question edits.

## Changes

### 1. questions table — add timestamps and marks
- `marks` (int, default 1) — per-question mark value
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())
- Trigger `questions_updated_at` auto-updates `updated_at` on every row update

### 2. submissions table — add question snapshot
- `question_snapshot` (jsonb, nullable) — stores a copy of all questions
  at submit time to protect historical results from later question edits.

### 3. RPC: duplicate_quiz(p_source_quiz_id, p_new_title)
- Copies the quiz row and all questions. Does NOT copy submissions/results.
- Returns the new quiz ID.

### 4. RPC: get_quiz_question_count(p_quiz_id)
- Returns question count for a quiz.

### 5. Updated RPC: submit_exam
- Now stores a JSON snapshot of all questions at submit time.

### 6. Updated RPC: generate_quiz_results
- Uses question_snapshot when available, falls back to live questions table.

## Security
- No new tables; existing RLS policies remain unchanged.
- duplicate_quiz granted to authenticated (admin) only.
- get_quiz_question_count available to anon+authenticated.
*/

-- ============================================================
-- 1. Helper function for updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Add timestamps and marks to questions table
-- ============================================================

DO $$ BEGIN
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS marks int NOT NULL DEFAULT 1;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Auto-update trigger for updated_at
DROP TRIGGER IF EXISTS questions_updated_at ON questions;
CREATE TRIGGER questions_updated_at
  BEFORE UPDATE ON questions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. Add question_snapshot to submissions table
-- ============================================================

DO $$ BEGIN
  ALTER TABLE submissions ADD COLUMN IF NOT EXISTS question_snapshot jsonb;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- 4. RPC: duplicate_quiz
-- ============================================================

CREATE OR REPLACE FUNCTION duplicate_quiz(
  p_source_quiz_id uuid,
  p_new_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source quizzes%ROWTYPE;
  v_new_id uuid;
  v_new_title text;
  v_count int;
BEGIN
  SELECT * INTO v_source FROM quizzes WHERE id = p_source_quiz_id;
  IF v_source.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Source quiz not found');
  END IF;

  v_new_title := COALESCE(NULLIF(p_new_title, ''), v_source.title || ' (Copy)');
  v_new_id := gen_random_uuid();

  INSERT INTO quizzes (id, title, description, quiz_date, start_time, end_time, duplicated_from)
  VALUES (
    v_new_id,
    v_new_title,
    v_source.description,
    v_source.quiz_date,
    v_source.start_time,
    v_source.end_time,
    p_source_quiz_id
  );

  INSERT INTO questions (quiz_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer, marks)
  SELECT
    v_new_id,
    question_number,
    question_text,
    option_a,
    option_b,
    option_c,
    option_d,
    correct_answer,
    COALESCE(marks, 1)
  FROM questions
  WHERE quiz_id = p_source_quiz_id
  ORDER BY question_number;

  SELECT count(*)::int INTO v_count FROM questions WHERE quiz_id = v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'new_quiz_id', v_new_id,
    'new_title', v_new_title,
    'questions_copied', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_quiz(uuid, text) TO authenticated;

-- ============================================================
-- 5. RPC: get_quiz_question_count
-- ============================================================

CREATE OR REPLACE FUNCTION get_quiz_question_count(p_quiz_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM questions WHERE quiz_id = p_quiz_id;
$$;

GRANT EXECUTE ON FUNCTION get_quiz_question_count(uuid) TO anon, authenticated;

-- ============================================================
-- 6. Updated RPC: submit_exam (with question snapshot)
-- ============================================================

CREATE OR REPLACE FUNCTION submit_exam(
  p_submission_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub submissions%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status = 'submitted' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'Already submitted');
  END IF;
  IF v_sub.status = 'expired' THEN
    RETURN jsonb_build_object('error', 'expired', 'message', 'This attempt has expired.');
  END IF;

  -- Build question snapshot for historical integrity
  SELECT jsonb_agg(jsonb_build_object(
    'question_number', q.question_number,
    'question_text', q.question_text,
    'option_a', q.option_a,
    'option_b', q.option_b,
    'option_c', q.option_c,
    'option_d', q.option_d,
    'correct_answer', q.correct_answer,
    'marks', COALESCE(q.marks, 1)
  ) ORDER BY q.question_number) INTO v_snapshot
  FROM questions q
  WHERE q.quiz_id = v_sub.quiz_id;

  UPDATE submissions
  SET answers = p_answers,
      status = 'submitted',
      submitted_at = now(),
      last_activity_at = now(),
      question_snapshot = v_snapshot,
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - attempt_started_at))::int)
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Exam submitted successfully');
END;
$$;

GRANT EXECUTE ON FUNCTION submit_exam(uuid, jsonb) TO anon, authenticated;

-- ============================================================
-- 7. Updated RPC: generate_quiz_results (uses snapshot when available)
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

  -- Score each submission. Use question_snapshot if available;
  -- fall back to live questions table for older submissions without snapshots.
  WITH scored AS (
    SELECT s.id,
           COALESCE(
             (
               SELECT count(*)::int
               FROM jsonb_array_elements(s.question_snapshot) AS snap
               WHERE upper(snap->>'correct_answer') = upper(
                 COALESCE(
                   (s.answers ->> (snap->>'question_number')),
                   ''
                 )
               )
             ),
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

  UPDATE quizzes SET results_generated = true WHERE id = p_quiz_id;

  SELECT count(*)::int INTO v_total FROM submissions WHERE quiz_id = p_quiz_id;
  SELECT COALESCE(max(score), 0) INTO v_top_score FROM submissions WHERE quiz_id = p_quiz_id;

  RETURN jsonb_build_object(
    'total_participants', v_total,
    'top_score', v_top_score,
    'quiz_id', p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generate_quiz_results(uuid) TO authenticated;