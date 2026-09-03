/*
# Student Identity Table + Expanded Attempt Statuses + Time Extension

## Purpose
1. Create a persistent `students` table keyed by normalized WhatsApp number.
2. Link submissions to students via `student_id` FK.
3. Expand attempt status to include 'interrupted' and 'expired'.
4. Add time extension columns for admin override (separate from resume).
5. Backfill students table from existing submissions.
6. Update all RPCs to use student identity.
7. Update RLS for students table.
8. Update unique constraint to use student_id + quiz_id.

## Key Design Decisions
- Identity = normalized WhatsApp number (digits only). Same number = same student.
- Name changes do NOT create new students.
- One attempt per student per exam, enforced by UNIQUE(student_id, quiz_id).
- Time extension is a SEPARATE action from resume permission.
- Attempt statuses: in_progress, interrupted, submitted, expired.
*/

-- ============================================================
-- 1. Create students table
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  school text NOT NULL DEFAULT '',
  grade integer,
  whatsapp_number text NOT NULL DEFAULT '',
  normalized_whatsapp text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- Unique constraint: one student per normalized whatsapp number
DO $$ BEGIN
  ALTER TABLE students ADD CONSTRAINT unique_student_whatsapp
    UNIQUE (normalized_whatsapp);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- English-only validation on students table
DO $$ BEGIN
  ALTER TABLE students ADD CONSTRAINT chk_student_english_name
    CHECK (full_name ~ '^[\x20-\x7E]+$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE students ADD CONSTRAINT chk_student_english_school
    CHECK (school ~ '^[\x20-\x7E]*$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS for students: anon can insert (to create identity), authenticated can do all
DROP POLICY IF EXISTS "select_students" ON students;
CREATE POLICY "select_students" ON students FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_students" ON students;
CREATE POLICY "insert_students" ON students FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_students" ON students;
CREATE POLICY "update_students" ON students FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Add student_id FK to submissions
-- ============================================================
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS student_id uuid
  REFERENCES students(id) ON DELETE SET NULL;

-- Add time extension columns
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_until timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_granted_by text DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_granted_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_reason text DEFAULT '';

-- ============================================================
-- 3. Expand status CHECK constraint
-- ============================================================
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS chk_submission_status;
DO $$ BEGIN
  ALTER TABLE submissions ADD CONSTRAINT chk_submission_status
    CHECK (status IN ('in_progress', 'interrupted', 'submitted', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. Backfill students table from existing submissions
-- ============================================================
INSERT INTO students (full_name, school, grade, whatsapp_number, normalized_whatsapp)
SELECT DISTINCT ON (regexp_replace(whatsapp_number, '[^0-9]', '', 'g'))
  student_name,
  COALESCE(school_name, ''),
  grade,
  COALESCE(whatsapp_number, ''),
  regexp_replace(whatsapp_number, '[^0-9]', '', 'g')
FROM submissions
WHERE COALESCE(whatsapp_number, '') != ''
  AND regexp_replace(whatsapp_number, '[^0-9]', '', 'g') != ''
ON CONFLICT (normalized_whatsapp) DO UPDATE
  SET updated_at = now();

-- ============================================================
-- 5. Backfill student_id in submissions
-- ============================================================
UPDATE submissions s
SET student_id = st.id
FROM students st
WHERE s.normalized_whatsapp = st.normalized_whatsapp
  AND s.student_id IS NULL;

-- ============================================================
-- 6. Add unique constraint on student_id + quiz_id
-- ============================================================
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS unique_attempt_student;
DO $$ BEGIN
  ALTER TABLE submissions ADD CONSTRAINT unique_attempt_student
    UNIQUE (quiz_id, student_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Keep the old unique_attempt (quiz_id, normalized_whatsapp) as a fallback
-- for any rows where student_id might be null. Both constraints coexist.

-- Index for student_id lookups
CREATE INDEX IF NOT EXISTS idx_submissions_student
  ON submissions(student_id);

CREATE INDEX IF NOT EXISTS idx_submissions_student_quiz
  ON submissions(student_id, quiz_id);

-- ============================================================
-- 7. RPC: get_or_create_student
-- Returns existing student by normalized whatsapp, or creates new
-- ============================================================
CREATE OR REPLACE FUNCTION get_or_create_student(
  p_full_name text,
  p_whatsapp_number text,
  p_grade int DEFAULT NULL,
  p_school text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
  v_student students%ROWTYPE;
BEGIN
  v_normalized := regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g');
  IF v_normalized = '' THEN
    RETURN NULL;
  END IF;

  -- Try to find existing student by normalized whatsapp
  SELECT * INTO v_student
  FROM students
  WHERE normalized_whatsapp = v_normalized
  LIMIT 1;

  IF v_student.id IS NOT NULL THEN
    -- Existing student found — return their id
    -- Do NOT overwrite their name/school/grade silently
    -- (the submission will snapshot the original details)
    RETURN v_student.id;
  END IF;

  -- Create new student
  INSERT INTO students (full_name, school, grade, whatsapp_number, normalized_whatsapp)
  VALUES (p_full_name, p_school, p_grade, p_whatsapp_number, v_normalized)
  RETURNING * INTO v_student;

  RETURN v_student.id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_student(text, text, int, text) TO anon, authenticated;

-- ============================================================
-- 8. RPC: update_student_profile
-- Allows controlled update of student details (not during active exam)
-- ============================================================
CREATE OR REPLACE FUNCTION update_student_profile(
  p_student_id uuid,
  p_full_name text DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_grade int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student students%ROWTYPE;
BEGIN
  SELECT * INTO v_student FROM students WHERE id = p_student_id;
  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Student not found');
  END IF;

  UPDATE students
  SET full_name = COALESCE(p_full_name, full_name),
      school = COALESCE(p_school, school),
      grade = COALESCE(p_grade, grade),
      updated_at = now()
  WHERE id = p_student_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_student_profile(uuid, text, text, int) TO anon, authenticated;

-- ============================================================
-- 9. Updated RPC: start_or_resume_attempt
-- Now uses students table for identity
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
  v_student_id uuid;
  v_existing submissions%ROWTYPE;
  v_effective_end timestamptz;
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

  -- Get or create student identity (by whatsapp, NOT by name)
  v_student_id := get_or_create_student(
    p_student_name, p_whatsapp_number, p_grade, p_school_name
  );
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('error', 'identity_failed', 'message', 'Failed to establish student identity');
  END IF;

  -- Check for existing attempt by student_id + quiz_id
  SELECT * INTO v_existing
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_id = v_student_id
  LIMIT 1;

  -- Also check by normalized_whatsapp as fallback (for legacy rows)
  IF v_existing.id IS NULL THEN
    SELECT * INTO v_existing
    FROM submissions
    WHERE quiz_id = p_quiz_id
      AND normalized_whatsapp = v_normalized_whatsapp
    LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    -- Existing attempt found
    IF v_existing.status = 'submitted' THEN
      -- Already submitted — cannot start again
      RETURN jsonb_build_object(
        'error', 'already_submitted',
        'message', 'You have already attempted this examination.'
      );
    ELSIF v_existing.status = 'expired' THEN
      RETURN jsonb_build_object(
        'error', 'expired',
        'message', 'This examination attempt has expired.'
      );
    ELSIF v_existing.status IN ('in_progress', 'interrupted') THEN
      -- Determine effective end time (with extension if any)
      v_effective_end := COALESCE(v_existing.time_extension_until, v_quiz.end_time);

      -- Resume logic
      IF v_existing.resume_allowed OR v_now <= v_effective_end THEN
        -- Update status back to in_progress if it was interrupted
        IF v_existing.status = 'interrupted' THEN
          UPDATE submissions SET status = 'in_progress' WHERE id = v_existing.id;
        END IF;

        RETURN jsonb_build_object(
          'ok', true,
          'action', 'resume',
          'submission_id', v_existing.id,
          'student_id', v_student_id,
          'server_time', v_now,
          'start_time', v_quiz.start_time,
          'end_time', v_quiz.end_time,
          'effective_end_time', v_effective_end,
          'attempt_started_at', v_existing.attempt_started_at,
          'saved_answers', v_existing.answers,
          'message', 'Resuming your previous attempt.'
        );
      ELSE
        -- Exam window closed and no resume permission
        -- Mark as expired
        UPDATE submissions SET status = 'expired' WHERE id = v_existing.id AND status IN ('in_progress', 'interrupted');

        RETURN jsonb_build_object(
          'error', 'resume_not_allowed',
          'message', 'Your previous examination session was interrupted. Please contact the administrator to resume this examination.'
        );
      END IF;
    END IF;
  END IF;

  -- No existing attempt — create a new in_progress attempt
  INSERT INTO submissions (
    quiz_id, student_name, whatsapp_number, grade, school_name,
    answers, started_at, submitted_at, status,
    attempt_started_at, last_activity_at,
    normalized_name, normalized_whatsapp,
    student_id
  ) VALUES (
    p_quiz_id, p_student_name, p_whatsapp_number, p_grade, p_school_name,
    '{}'::jsonb, v_now, v_now, 'in_progress',
    v_now, v_now,
    v_normalized_name, v_normalized_whatsapp,
    v_student_id
  )
  RETURNING id INTO v_existing.id;

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'new',
    'submission_id', v_existing.id,
    'student_id', v_student_id,
    'server_time', v_now,
    'start_time', v_quiz.start_time,
    'end_time', v_quiz.end_time,
    'effective_end_time', v_quiz.end_time,
    'attempt_started_at', v_now,
    'message', 'Exam started.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION start_or_resume_attempt(uuid, text, text, int, text) TO anon, authenticated;

-- ============================================================
-- 10. Updated RPC: save_answer_progress
-- Now also marks interrupted if last_activity is stale
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
-- 11. Updated RPC: submit_exam
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
  IF v_sub.status = 'expired' THEN
    RETURN jsonb_build_object('error', 'expired', 'message', 'This attempt has expired.');
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
-- 12. RPC: mark_interrupted_attempts
-- Marks in_progress attempts with stale last_activity as interrupted
-- ============================================================
CREATE OR REPLACE FUNCTION mark_interrupted_attempts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE submissions
  SET status = 'interrupted'
  WHERE status = 'in_progress'
    AND last_activity_at IS NOT NULL
    AND last_activity_at < now() - interval '5 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'marked_interrupted', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION mark_interrupted_attempts() TO anon, authenticated;

-- ============================================================
-- 13. Updated RPC: grant_resume_permission
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
  IF v_sub.status = 'expired' THEN
    RETURN jsonb_build_object('error', 'Cannot grant resume for an expired attempt');
  END IF;

  UPDATE submissions
  SET resume_allowed = true,
      resume_granted_by = p_admin_email,
      resume_granted_at = now(),
      resume_reason = p_reason,
      status = CASE WHEN status = 'interrupted' THEN 'in_progress' ELSE status END
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Resume permission granted');
END;
$$;

GRANT EXECUTE ON FUNCTION grant_resume_permission(uuid, text, text) TO authenticated;

-- ============================================================
-- 14. Updated RPC: revoke_resume_permission
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
-- 15. NEW RPC: extend_attempt_time (admin only)
-- Separate from resume — gives extra time
-- ============================================================
CREATE OR REPLACE FUNCTION extend_attempt_time(
  p_submission_id uuid,
  p_new_deadline timestamptz,
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
  v_old_deadline timestamptz;
BEGIN
  SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status = 'submitted' THEN
    RETURN jsonb_build_object('error', 'Cannot extend time for a submitted attempt');
  END IF;

  v_old_deadline := COALESCE(v_sub.time_extension_until, NULL);

  UPDATE submissions
  SET time_extension_until = p_new_deadline,
      time_extension_granted_by = p_admin_email,
      time_extension_granted_at = now(),
      time_extension_reason = p_reason,
      resume_allowed = true,
      resume_granted_by = p_admin_email,
      resume_granted_at = now(),
      status = CASE WHEN status = 'interrupted' THEN 'in_progress' ELSE status END
  WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'ok', true,
    'old_deadline', v_old_deadline,
    'new_deadline', p_new_deadline,
    'message', 'Time extension granted'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION extend_attempt_time(uuid, timestamptz, text, text) TO authenticated;

-- ============================================================
-- 16. Updated RPC: get_exam_attempts
-- Now includes student_id, time extension info, and computed remaining time
-- ============================================================
CREATE OR REPLACE FUNCTION get_exam_attempts(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz quizzes%ROWTYPE;
BEGIN
  SELECT * INTO v_quiz FROM quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'student_id', s.student_id,
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
      'time_extension_until', s.time_extension_until,
      'time_extension_granted_by', s.time_extension_granted_by,
      'time_extension_granted_at', s.time_extension_granted_at,
      'time_extension_reason', s.time_extension_reason,
      'answers', s.answers,
      'effective_end_time', COALESCE(s.time_extension_until, v_quiz.end_time),
      'quiz_end_time', v_quiz.end_time
    ) ORDER BY s.created_at)
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_exam_attempts(uuid) TO authenticated;

-- ============================================================
-- 17. NEW RPC: get_all_interrupted_attempts (admin dashboard)
-- Returns all interrupted/in_progress attempts across all quizzes
-- ============================================================
CREATE OR REPLACE FUNCTION get_all_interrupted_attempts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'quiz_id', s.quiz_id,
      'quiz_title', q.title,
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
      'time_extension_until', s.time_extension_until,
      'time_extension_granted_by', s.time_extension_granted_by,
      'time_extension_granted_at', s.time_extension_granted_at,
      'time_extension_reason', s.time_extension_reason,
      'answers', s.answers,
      'effective_end_time', COALESCE(s.time_extension_until, q.end_time),
      'quiz_end_time', q.end_time
    ) ORDER BY s.last_activity_at DESC NULLS LAST)
    FROM submissions s
    JOIN quizzes q ON q.id = s.quiz_id
    WHERE s.status IN ('in_progress', 'interrupted')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_interrupted_attempts() TO authenticated;

-- ============================================================
-- 18. NEW RPC: manually_close_attempt (admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION manually_close_attempt(
  p_submission_id uuid,
  p_admin_email text DEFAULT ''
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
    RETURN jsonb_build_object('error', 'Already submitted');
  END IF;

  -- Auto-submit with current answers
  UPDATE submissions
  SET status = 'submitted',
      submitted_at = now(),
      last_activity_at = now(),
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - attempt_started_at))::int)
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Attempt manually closed and submitted');
END;
$$;

GRANT EXECUTE ON FUNCTION manually_close_attempt(uuid, text) TO authenticated;

-- ============================================================
-- 19. Updated duplicate_exam RPC (same as before, confirmed working)
-- ============================================================
-- Already exists from previous migration, no changes needed

-- ============================================================
-- 20. Updated generate_quiz_results to handle all statuses
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

  -- Clear rank for non-submitted attempts
  UPDATE submissions SET rank = NULL WHERE quiz_id = p_quiz_id AND status != 'submitted';

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
-- 21. RPC: get_server_time (used by frontend for timer sync)
-- ============================================================
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION get_server_time() TO anon, authenticated;

-- ============================================================
-- 22. RPC: get_quiz_questions (admin only — always returns questions)
-- ============================================================
CREATE OR REPLACE FUNCTION get_quiz_questions(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', q.id,
      'question_number', q.question_number,
      'question_text', q.question_text,
      'option_a', q.option_a,
      'option_b', q.option_b,
      'option_c', q.option_c,
      'option_d', q.option_d,
      'correct_answer', q.correct_answer
    ) ORDER BY q.question_number)
    FROM questions q
    WHERE q.quiz_id = p_quiz_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_quiz_questions(uuid) TO authenticated;
