/*
# Student Identity, One-Attempt Enforcement, Resume, Admin Controls, Exam Duplication

## Overview
Implements strict student identity enforcement (one attempt per exam), resume of interrupted
attempts, admin resume permission controls, English-only validation at DB level, exam
duplication, and exam history tracking.

## Changes

### 1. New columns on submissions
- `status` (text) — 'in_progress' | 'submitted' — tracks attempt lifecycle
- `resume_allowed` (boolean, default false) — admin grants resume permission
- `resume_granted_by` (text) — admin email who granted resume
- `resume_granted_at` (timestamptz) — when resume was granted
- `resume_reason` (text) — optional reason for resume
- `last_activity_at` (timestamptz) — last time answers were saved
- `normalized_name` (text) — uppercase trimmed name for identity matching
- `normalized_whatsapp` (text) — digits-only phone for identity matching

### 2. New columns on quizzes
- `duplicated_from` (uuid, nullable) — links to original quiz if this is a duplicate

### 3. Unique constraint change
- Drop old unique_submission (quiz_id, student_name, whatsapp_number)
- Add unique_attempt (quiz_id, normalized_whatsapp) — one attempt per exam per phone number
  This means even if a student changes their name, the same WhatsApp number = same identity = blocked

### 4. New RPCs
- `start_or_resume_attempt` — creates in_progress attempt or resumes existing one
- `save_answer_progress` — progressively saves answers + last_activity_at
- `submit_exam` — finalizes submission, sets status to 'submitted'
- `check_existing_attempt` — checks if student already has an attempt
- `grant_resume_permission` — admin grants resume for an interrupted attempt
- `revoke_resume_permission` — admin revokes resume
- `get_exam_attempts` — admin views all attempts for a quiz
- `duplicate_exam` — creates a new quiz from an existing one's questions
- `validate_english_text` — helper to reject non-ASCII text

### 5. RLS updates
- Allow anon UPDATE on submissions (for progressive answer saving + resume)
- Keep admin-only DELETE

### Important Notes
1. Identity is based on normalized WhatsApp number (digits only), NOT name.
   A student changing their name but using the same phone = same identity = blocked.
2. Attempt status tracks lifecycle: in_progress → submitted.
3. Resume keeps the original timer (started_at unchanged).
4. English-only validation enforced at DB level via CHECK constraint.
*/

-- ============================================================
-- 1. Add columns to submissions
-- ============================================================
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_granted_by text DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_granted_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_reason text DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS normalized_name text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS normalized_whatsapp text NOT NULL DEFAULT '';

-- Add CHECK constraint for status
DO $$ BEGIN
  ALTER TABLE submissions ADD CONSTRAINT chk_submission_status
    CHECK (status IN ('in_progress', 'submitted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add CHECK constraint for English-only student_name and school_name
DO $$ BEGIN
  ALTER TABLE submissions ADD CONSTRAINT chk_english_name
    CHECK (student_name ~ '^[\x20-\x7E]+$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE submissions ADD CONSTRAINT chk_english_school
    CHECK (school_name ~ '^[\x20-\x7E]*$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Add duplicated_from to quizzes
-- ============================================================
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS duplicated_from uuid;

-- ============================================================
-- 3. Update existing submissions: set normalized fields + status
-- ============================================================
UPDATE submissions
SET normalized_name = upper(trim(student_name)),
    normalized_whatsapp = regexp_replace(whatsapp_number, '[^0-9]', '', 'g')
WHERE normalized_name = '' AND normalized_whatsapp = '';

UPDATE submissions SET status = 'submitted' WHERE status = '' OR status IS NULL;

-- ============================================================
-- 4. Drop old unique constraint, add new one based on normalized identity
-- ============================================================
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS unique_submission;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS unique_attempt;

-- Add unique constraint: one attempt per quiz per normalized whatsapp number
ALTER TABLE submissions ADD CONSTRAINT unique_attempt
  UNIQUE (quiz_id, normalized_whatsapp);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_whatsapp
  ON submissions(quiz_id, normalized_whatsapp);

CREATE INDEX IF NOT EXISTS idx_submissions_quiz_status
  ON submissions(quiz_id, status);

CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions(status);

CREATE INDEX IF NOT EXISTS idx_quizzes_duplicated_from
  ON quizzes(duplicated_from);

-- ============================================================
-- 5. RLS: Allow anon UPDATE on submissions (for progressive save + resume)
-- ============================================================
DROP POLICY IF EXISTS "update_submissions" ON submissions;
CREATE POLICY "update_submissions" ON submissions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 6. RPC: start_or_resume_attempt
-- Creates a new in_progress attempt OR resumes an existing one
-- Identity = normalized whatsapp number (digits only)
-- ============================================================
CREATE OR REPLACE FUNCTION start_or_resume_attempt(
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
  v_existing submissions%ROWTYPE;
BEGIN
  -- Validate quiz exists
  SELECT * INTO v_quiz FROM quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  v_now := now();

  -- Validate exam window
  IF v_now < v_quiz.start_time THEN
    RETURN jsonb_build_object(
      'error', 'before_start',
      'server_time', v_now,
      'start_time', v_quiz.start_time,
      'message', 'Exam has not started yet'
    );
  END IF;

  IF v_now > v_quiz.end_time THEN
    RETURN jsonb_build_object(
      'error', 'after_end',
      'server_time', v_now,
      'end_time', v_quiz.end_time,
      'message', 'Exam window has closed'
    );
  END IF;

  -- Normalize identity
  v_normalized_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');
  v_normalized_name := upper(trim(p_student_name));

  IF v_normalized_whatsapp = '' THEN
    RETURN jsonb_build_object('error', 'invalid_phone', 'message', 'A valid WhatsApp number is required');
  END IF;

  IF v_normalized_name = '' THEN
    RETURN jsonb_build_object('error', 'invalid_name', 'message', 'Name is required');
  END IF;

  -- Check for existing attempt by normalized whatsapp
  SELECT * INTO v_existing
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = v_normalized_whatsapp
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    -- Existing attempt found
    IF v_existing.status = 'submitted' THEN
      -- Already submitted — cannot start again
      RETURN jsonb_build_object(
        'error', 'already_submitted',
        'message', 'You have already attempted this examination.'
      );
    ELSIF v_existing.status = 'in_progress' THEN
      -- Resume logic: allow if resume_allowed OR if exam window is still open
      IF v_existing.resume_allowed OR v_now <= v_quiz.end_time THEN
        RETURN jsonb_build_object(
          'ok', true,
          'action', 'resume',
          'submission_id', v_existing.id,
          'server_time', v_now,
          'start_time', v_quiz.start_time,
          'end_time', v_quiz.end_time,
          'attempt_started_at', v_existing.attempt_started_at,
          'saved_answers', v_existing.answers,
          'message', 'Resuming your previous attempt.'
        );
      ELSE
        RETURN jsonb_build_object(
          'error', 'resume_not_allowed',
          'message', 'Your previous attempt was interrupted and the exam window has closed. Please contact the administrator.'
        );
      END IF;
    END IF;
  END IF;

  -- No existing attempt — create a new in_progress attempt
  INSERT INTO submissions (
    quiz_id, student_name, whatsapp_number, grade, school_name,
    answers, started_at, submitted_at, status,
    attempt_started_at, last_activity_at,
    normalized_name, normalized_whatsapp
  ) VALUES (
    p_quiz_id, p_student_name, p_whatsapp_number, p_grade, p_school_name,
    '{}'::jsonb, v_now, v_now, 'in_progress',
    v_now, v_now,
    v_normalized_name, v_normalized_whatsapp
  )
  RETURNING id INTO v_existing.id;

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'new',
    'submission_id', v_existing.id,
    'server_time', v_now,
    'start_time', v_quiz.start_time,
    'end_time', v_quiz.end_time,
    'attempt_started_at', v_now,
    'message', 'Exam started.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION start_or_resume_attempt(uuid, text, text, int, text) TO anon, authenticated;

-- ============================================================
-- 7. RPC: save_answer_progress
-- Progressively saves answers + updates last_activity_at
-- Only works on in_progress attempts
-- ============================================================
CREATE OR REPLACE FUNCTION save_answer_progress(
  p_submission_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM submissions WHERE id = p_submission_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'already_submitted', 'message', 'This exam has already been submitted.');
  END IF;

  UPDATE submissions
  SET answers = p_answers,
      last_activity_at = now()
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION save_answer_progress(uuid, jsonb) TO anon, authenticated;

-- ============================================================
-- 8. RPC: submit_exam
-- Finalizes submission: sets status, submitted_at, computes time
-- Only works on in_progress attempts
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
BEGIN
  SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status = 'submitted' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'Already submitted');
  END IF;

  UPDATE submissions
  SET answers = p_answers,
      status = 'submitted',
      submitted_at = now(),
      last_activity_at = now(),
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - attempt_started_at))::int)
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Exam submitted successfully');
END;
$$;

GRANT EXECUTE ON FUNCTION submit_exam(uuid, jsonb) TO anon, authenticated;

-- ============================================================
-- 9. RPC: check_existing_attempt
-- Checks if a student already has an attempt for a quiz
-- ============================================================
CREATE OR REPLACE FUNCTION check_existing_attempt(
  p_quiz_id uuid,
  p_whatsapp_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_whatsapp text;
  v_existing submissions%ROWTYPE;
BEGIN
  v_normalized_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');
  IF v_normalized_whatsapp = '' THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  SELECT * INTO v_existing
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = v_normalized_whatsapp
  LIMIT 1;

  IF v_existing.id IS NULL THEN
    RETURN jsonb_build_object('has_attempt', false);
  END IF;

  RETURN jsonb_build_object(
    'has_attempt', true,
    'status', v_existing.status,
    'resume_allowed', v_existing.resume_allowed,
    'submission_id', v_existing.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_existing_attempt(uuid, text) TO anon, authenticated;

-- ============================================================
-- 10. RPC: grant_resume_permission (admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION grant_resume_permission(
  p_submission_id uuid,
  p_admin_email text DEFAULT '',
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status = 'submitted' THEN
    RETURN jsonb_build_object('error', 'Cannot grant resume for a submitted attempt');
  END IF;

  UPDATE submissions
  SET resume_allowed = true,
      resume_granted_by = p_admin_email,
      resume_granted_at = now(),
      resume_reason = p_reason
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Resume permission granted');
END;
$$;

GRANT EXECUTE ON FUNCTION grant_resume_permission(uuid, text, text) TO authenticated;

-- ============================================================
-- 11. RPC: revoke_resume_permission (admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION revoke_resume_permission(
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE submissions
  SET resume_allowed = false,
      resume_granted_by = '',
      resume_granted_at = NULL,
      resume_reason = ''
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Resume permission revoked');
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_resume_permission(uuid) TO authenticated;

-- ============================================================
-- 12. RPC: get_exam_attempts (admin only)
-- Returns all attempts for a quiz with full details
-- ============================================================
CREATE OR REPLACE FUNCTION get_exam_attempts(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'student_name', s.student_name,
      'school_name', s.school_name,
      'grade', s.grade,
      'whatsapp_number', s.whatsapp_number,
      'status', s.status,
      'score', s.score,
      'rank', s.rank,
      'started_at', s.started_at,
      'attempt_started_at', s.attempt_started_at,
      'submitted_at', s.submitted_at,
      'time_taken_seconds', s.time_taken_seconds,
      'last_activity_at', s.last_activity_at,
      'resume_allowed', s.resume_allowed,
      'resume_granted_by', s.resume_granted_by,
      'resume_granted_at', s.resume_granted_at,
      'resume_reason', s.resume_reason,
      'answers', s.answers
    ) ORDER BY s.created_at)
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_exam_attempts(uuid) TO authenticated;

-- ============================================================
-- 13. RPC: duplicate_exam (admin only)
-- Creates a new quiz from an existing quiz's questions/options
-- Original exam's results/rankings remain unchanged
-- ============================================================
CREATE OR REPLACE FUNCTION duplicate_exam(
  p_source_quiz_id uuid,
  p_new_title text,
  p_new_quiz_date date,
  p_new_start_time timestamptz,
  p_new_end_time timestamptz,
  p_new_description text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_quiz_id uuid;
  v_count int;
BEGIN
  -- Verify source quiz exists
  SELECT count(*) INTO v_count FROM quizzes WHERE id = p_source_quiz_id;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('error', 'Source quiz not found');
  END IF;

  -- Create new quiz
  INSERT INTO quizzes (title, description, quiz_date, start_time, end_time, duplicated_from)
  VALUES (p_new_title, p_new_description, p_new_quiz_date, p_new_start_time, p_new_end_time, p_source_quiz_id)
  RETURNING id INTO v_new_quiz_id;

  -- Copy all questions from source to new quiz
  INSERT INTO questions (quiz_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer)
  SELECT v_new_quiz_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer
  FROM questions
  WHERE quiz_id = p_source_quiz_id
  ORDER BY question_number;

  SELECT count(*) INTO v_count FROM questions WHERE quiz_id = v_new_quiz_id;

  RETURN jsonb_build_object(
    'ok', true,
    'new_quiz_id', v_new_quiz_id,
    'questions_copied', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_exam(uuid, text, date, timestamptz, timestamptz, text) TO authenticated;

-- ============================================================
-- 14. Update generate_quiz_results to only score submitted attempts
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

  -- Score only submitted attempts
  WITH scored AS (
    SELECT s.id,
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
      AND s.status = 'submitted'
  ),
  ranked AS (
    SELECT scored.id,
           scored.calc_score,
           RANK() OVER (
             ORDER BY scored.calc_score DESC, submitted_at ASC
           ) AS calc_rank
    FROM scored
    JOIN submissions s2 ON s2.id = scored.id
  )
  UPDATE submissions
  SET score = ranked.calc_score,
      rank = ranked.calc_rank,
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (submitted_at - started_at))::int)
  FROM ranked
  WHERE submissions.id = ranked.id;

  -- Clear rank for in_progress attempts
  UPDATE submissions SET rank = NULL WHERE quiz_id = p_quiz_id AND status = 'in_progress';

  UPDATE quizzes
  SET results_generated = true,
      results_confirmed = false,
      results_published = false
  WHERE id = p_quiz_id;

  SELECT count(*)::int INTO v_total FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';
  SELECT COALESCE(max(score), 0) INTO v_top_score FROM submissions WHERE quiz_id = p_quiz_id;

  RETURN jsonb_build_object(
    'total_participants', v_total,
    'top_score', v_top_score,
    'quiz_id', p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generate_quiz_results(uuid) TO authenticated;

-- ============================================================
-- 15. Update get_published_top10 to only include submitted attempts
-- ============================================================
CREATE OR REPLACE FUNCTION get_published_top10(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_published boolean;
BEGIN
  SELECT results_published INTO v_published FROM quizzes WHERE id = p_quiz_id;
  IF v_published IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  IF NOT v_published THEN
    RETURN jsonb_build_object('error', 'Results not published');
  END IF;

  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'rank', s.rank,
      'student_name', s.student_name,
      'school_name', s.school_name,
      'grade', s.grade,
      'whatsapp_number', s.whatsapp_number,
      'score', s.score,
      'photo_url', s.photo_url
    ) ORDER BY s.rank)
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
      AND s.rank IS NOT NULL
      AND s.rank <= 10
      AND s.status = 'submitted'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_published_top10(uuid) TO authenticated;

-- ============================================================
-- 16. Update get_student_result to only return submitted results
-- ============================================================
DROP FUNCTION IF EXISTS get_student_result(uuid, text, text);

CREATE FUNCTION get_student_result(
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
  v_published boolean;
  v_total_questions int;
  v_total_participants int;
  v_sub submissions%ROWTYPE;
  v_correct int;
  v_unanswered int;
  v_percentage numeric;
  v_normalized_whatsapp text;
BEGIN
  SELECT results_published INTO v_published FROM quizzes WHERE id = p_quiz_id;
  IF v_published IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  IF NOT v_published THEN
    RETURN jsonb_build_object('error', 'Results have not been published yet');
  END IF;

  v_normalized_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');

  SELECT * INTO v_sub
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = v_normalized_whatsapp
    AND status = 'submitted'
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unable to find a published result with these details');
  END IF;

  SELECT count(*)::int INTO v_total_questions FROM questions WHERE quiz_id = p_quiz_id;
  SELECT count(*)::int INTO v_total_participants FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';

  v_correct := v_sub.score;
  v_unanswered := v_total_questions - (
    SELECT count(*)::int FROM jsonb_object_keys(v_sub.answers)
  );
  v_percentage := ROUND((v_correct::numeric / GREATEST(v_total_questions, 1)) * 100, 1);

  RETURN jsonb_build_object(
    'score', v_correct,
    'rank', v_sub.rank,
    'total_participants', v_total_participants,
    'total_questions', v_total_questions,
    'correct', v_correct,
    'incorrect', v_total_questions - v_correct - v_unanswered,
    'unanswered', v_unanswered,
    'percentage', v_percentage,
    'student_name', v_sub.student_name,
    'school_name', v_sub.school_name,
    'grade', v_sub.grade,
    'is_top_10', (v_sub.rank IS NOT NULL AND v_sub.rank <= 10),
    'photo_url', v_sub.photo_url,
    'time_taken_seconds', v_sub.time_taken_seconds,
    'submitted_at', v_sub.submitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_result(uuid, text, text) TO anon, authenticated;

-- ============================================================
-- 17. Update verify_top10_and_get_upload_token to use normalized whatsapp
-- ============================================================
CREATE OR REPLACE FUNCTION verify_top10_and_get_upload_token(
  p_quiz_id uuid,
  p_student_name text,
  p_whatsapp_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_published boolean;
  v_sub submissions%ROWTYPE;
  v_normalized_whatsapp text;
BEGIN
  SELECT results_published INTO v_published FROM quizzes WHERE id = p_quiz_id;
  IF v_published IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  IF NOT v_published THEN
    RETURN jsonb_build_object('error', 'Results have not been published yet');
  END IF;

  v_normalized_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');

  SELECT * INTO v_sub
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = v_normalized_whatsapp
    AND status = 'submitted'
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unable to find a published result with these details');
  END IF;

  IF v_sub.rank IS NULL OR v_sub.rank > 10 THEN
    RETURN jsonb_build_object('error', 'not_top_10', 'rank', v_sub.rank);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'submission_id', v_sub.id,
    'rank', v_sub.rank,
    'quiz_id', p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_top10_and_get_upload_token(uuid, text, text) TO anon, authenticated;

-- ============================================================
-- 18. Update update_photo_url to use normalized whatsapp
-- ============================================================
CREATE OR REPLACE FUNCTION update_photo_url(
  p_quiz_id uuid,
  p_student_name text,
  p_whatsapp_number text,
  p_photo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub submissions%ROWTYPE;
  v_normalized_whatsapp text;
BEGIN
  v_normalized_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');

  SELECT * INTO v_sub
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = v_normalized_whatsapp
    AND status = 'submitted'
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;

  IF v_sub.rank IS NULL OR v_sub.rank > 10 THEN
    RETURN jsonb_build_object('error', 'Only Top 10 students can upload photos');
  END IF;

  UPDATE submissions
  SET photo_url = p_photo_url,
      photo_uploaded_at = now()
  WHERE id = v_sub.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_photo_url(uuid, text, text, text) TO anon, authenticated;
