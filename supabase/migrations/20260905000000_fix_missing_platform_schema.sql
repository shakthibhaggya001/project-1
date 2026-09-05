-- Fix missing platform tables and ensure the app works against the live Supabase project.
-- This migration is idempotent and safe to run repeatedly.

CREATE TABLE IF NOT EXISTS quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  quiz_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  results_generated boolean NOT NULL DEFAULT false,
  results_confirmed boolean NOT NULL DEFAULT false,
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

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  school text NOT NULL DEFAULT '',
  grade integer,
  whatsapp_number text NOT NULL DEFAULT '',
  normalized_whatsapp text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_student_whatsapp UNIQUE (normalized_whatsapp)
);

CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_identifier text NOT NULL DEFAULT '',
  grade int,
  school_name text NOT NULL DEFAULT '',
  whatsapp_number text NOT NULL DEFAULT '',
  normalized_name text NOT NULL DEFAULT '',
  normalized_whatsapp text NOT NULL DEFAULT '',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score int NOT NULL DEFAULT 0,
  rank int,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  time_taken_seconds int,
  attempt_started_at timestamptz,
  last_activity_at timestamptz,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress','interrupted','submitted','expired')),
  resume_allowed boolean NOT NULL DEFAULT false,
  resume_granted_by text NOT NULL DEFAULT '',
  resume_granted_at timestamptz,
  resume_reason text NOT NULL DEFAULT '',
  photo_url text DEFAULT '',
  photo_uploaded_at timestamptz,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  time_extension_until timestamptz,
  time_extension_granted_by text NOT NULL DEFAULT '',
  time_extension_granted_at timestamptz,
  time_extension_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  question_snapshot jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT unique_submission UNIQUE (quiz_id, student_name, whatsapp_number)
);

CREATE TABLE IF NOT EXISTS site_settings (
  id integer PRIMARY KEY DEFAULT 1,
  portal_title text NOT NULL DEFAULT 'Test your knowledge. Claim your rank.',
  subtitle text NOT NULL DEFAULT 'Online Examination Portal',
  description text NOT NULL DEFAULT '40 questions. 40 minutes. Take the timed exam and check your results as soon as they are published.',
  contact_numbers text NOT NULL DEFAULT '',
  poster_url text NOT NULL DEFAULT '',
  primary_color text NOT NULL DEFAULT '#1c4f9d',
  background_color text NOT NULL DEFAULT '#171918',
  card_color text NOT NULL DEFAULT '#2b312c',
  motivational_banner_url text NOT NULL DEFAULT '',
  motivational_quote text NOT NULL DEFAULT '',
  show_motivational_banner boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS does not repair tables created by older migrations.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS student_identifier text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grade int;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS school_name text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS whatsapp_number text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS normalized_name text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS normalized_whatsapp text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS score int NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS rank int;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_taken_seconds int;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_granted_by text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_granted_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resume_reason text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS photo_url text DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS photo_uploaded_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS student_id uuid;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_until timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_granted_by text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_granted_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_extension_reason text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS question_snapshot jsonb DEFAULT '[]'::jsonb;

ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS motivational_banner_url text NOT NULL DEFAULT '';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS motivational_quote text NOT NULL DEFAULT '';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS show_motivational_banner boolean NOT NULL DEFAULT true;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS marks int NOT NULL DEFAULT 1;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS results_generated boolean NOT NULL DEFAULT false;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS results_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS results_published boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id_qnum ON questions(quiz_id, question_number);
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_id ON submissions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_id_rank ON submissions(quiz_id, rank);
CREATE INDEX IF NOT EXISTS idx_submissions_quiz_id_score ON submissions(quiz_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id_quiz ON submissions(student_id, quiz_id);

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_quizzes" ON quizzes;
CREATE POLICY "read_quizzes" ON quizzes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_quizzes" ON quizzes;
CREATE POLICY "insert_quizzes" ON quizzes FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_quizzes" ON quizzes;
CREATE POLICY "update_quizzes" ON quizzes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_quizzes" ON quizzes;
CREATE POLICY "delete_quizzes" ON quizzes FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "read_questions" ON questions;
CREATE POLICY "read_questions" ON questions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_questions" ON questions;
CREATE POLICY "insert_questions" ON questions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_questions" ON questions;
CREATE POLICY "update_questions" ON questions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_questions" ON questions;
CREATE POLICY "delete_questions" ON questions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "select_students" ON students;
CREATE POLICY "select_students" ON students FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_students" ON students;
CREATE POLICY "insert_students" ON students FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_students" ON students;
CREATE POLICY "update_students" ON students FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "insert_submissions" ON submissions;
CREATE POLICY "insert_submissions" ON submissions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "read_submissions" ON submissions;
CREATE POLICY "read_submissions" ON submissions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "update_submissions" ON submissions;
CREATE POLICY "update_submissions" ON submissions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_submissions" ON submissions;
CREATE POLICY "delete_submissions" ON submissions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "read_site_settings" ON site_settings;
CREATE POLICY "read_site_settings" ON site_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "write_site_settings" ON site_settings;
CREATE POLICY "write_site_settings" ON site_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_site_settings" ON site_settings;
CREATE POLICY "update_site_settings" ON site_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION get_server_time()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION get_server_time() TO anon, authenticated;

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

  SELECT * INTO v_student
  FROM students
  WHERE normalized_whatsapp = v_normalized
  LIMIT 1;

  IF v_student.id IS NOT NULL THEN
    RETURN v_student.id;
  END IF;

  INSERT INTO students (full_name, school, grade, whatsapp_number, normalized_whatsapp)
  VALUES (p_full_name, p_school, p_grade, p_whatsapp_number, v_normalized)
  RETURNING * INTO v_student;

  RETURN v_student.id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_student(text, text, int, text) TO anon, authenticated;

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
BEGIN
  SELECT * INTO v_quiz FROM quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  v_now := now();

  IF v_now < v_quiz.start_time THEN
    RETURN jsonb_build_object('error', 'before_start', 'server_time', v_now, 'start_time', v_quiz.start_time, 'message', 'Exam has not started yet');
  END IF;

  IF v_now > v_quiz.end_time THEN
    RETURN jsonb_build_object('error', 'after_end', 'server_time', v_now, 'end_time', v_quiz.end_time, 'message', 'Exam window has closed');
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

  SELECT * INTO v_existing
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_id = v_student_id
  LIMIT 1;

  IF v_existing.id IS NULL THEN
    SELECT * INTO v_existing
    FROM submissions
    WHERE quiz_id = p_quiz_id
      AND normalized_whatsapp = v_normalized_whatsapp
    LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'submitted' THEN
      RETURN jsonb_build_object('error', 'already_submitted', 'message', 'You have already attempted this examination.');
    ELSIF v_existing.status = 'expired' THEN
      RETURN jsonb_build_object('error', 'expired', 'message', 'This examination attempt has expired.');
    ELSIF v_existing.status IN ('in_progress','interrupted') THEN
      RETURN jsonb_build_object(
        'ok', true,
        'action', 'resume',
        'submission_id', v_existing.id,
        'student_id', v_student_id,
        'server_time', v_now,
        'start_time', v_quiz.start_time,
        'end_time', v_quiz.end_time,
        'effective_end_time', COALESCE(v_existing.time_extension_until, v_quiz.end_time),
        'attempt_started_at', COALESCE(v_existing.attempt_started_at, v_existing.started_at),
        'saved_answers', v_existing.answers,
        'message', 'Resuming your previous attempt.'
      );
    END IF;
  END IF;

  INSERT INTO submissions (
    quiz_id,
    student_name,
    whatsapp_number,
    grade,
    school_name,
    answers,
    started_at,
    submitted_at,
    status,
    attempt_started_at,
    last_activity_at,
    normalized_name,
    normalized_whatsapp,
    student_id
  ) VALUES (
    p_quiz_id,
    p_student_name,
    p_whatsapp_number,
    p_grade,
    p_school_name,
    '{}'::jsonb,
    v_now,
    v_now,
    'in_progress',
    v_now,
    v_now,
    v_normalized_name,
    v_normalized_whatsapp,
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
  v_submission submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id;
  IF v_submission.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;

  UPDATE submissions
  SET answers = COALESCE(p_answers, '{}'::jsonb),
      last_activity_at = now()
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Progress saved');
END;
$$;

GRANT EXECUTE ON FUNCTION save_answer_progress(uuid, jsonb) TO anon, authenticated;

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

  SELECT jsonb_agg(jsonb_build_object(
    'question_number', q.question_number,
    'question_text', q.question_text,
    'option_a', q.option_a,
    'option_b', q.option_b,
    'option_c', q.option_c,
    'option_d', q.option_d,
    'correct_answer', q.correct_answer,
    'marks', 1
  ) ORDER BY q.question_number) INTO v_snapshot
  FROM questions q
  WHERE q.quiz_id = v_sub.quiz_id;

  UPDATE submissions
  SET answers = p_answers,
      status = 'submitted',
      submitted_at = now(),
      last_activity_at = now(),
      question_snapshot = COALESCE(v_snapshot, '[]'::jsonb),
      time_taken_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(attempt_started_at, started_at)))::int)
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Exam submitted successfully');
END;
$$;

GRANT EXECUTE ON FUNCTION submit_exam(uuid, jsonb) TO anon, authenticated;

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

  WITH scored AS (
    SELECT s.id,
      (
        SELECT count(*)::int
        FROM questions q
        WHERE q.quiz_id = s.quiz_id
          AND upper(q.correct_answer::text) = upper(COALESCE((s.answers ->> q.question_number::text), ''))
      ) AS calc_score
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id
      AND s.status = 'submitted'
  )
  UPDATE submissions s
  SET score = scored.calc_score
  FROM scored
  WHERE s.id = scored.id;

  UPDATE submissions
  SET rank = NULL
  WHERE quiz_id = p_quiz_id
    AND status <> 'submitted';

  SELECT count(*)::int INTO v_total FROM submissions WHERE quiz_id = p_quiz_id;
  SELECT COALESCE(max(score), 0) INTO v_top_score FROM submissions WHERE quiz_id = p_quiz_id;

  UPDATE quizzes SET results_generated = true WHERE id = p_quiz_id;

  RETURN jsonb_build_object('total_participants', v_total, 'top_score', v_top_score, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION generate_quiz_results(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION confirm_quiz_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_generated boolean;
BEGIN
  SELECT results_generated INTO v_generated FROM quizzes WHERE id = p_quiz_id;
  IF v_generated IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  IF NOT v_generated THEN
    RETURN jsonb_build_object('error', 'Results must be generated first');
  END IF;
  UPDATE quizzes SET results_confirmed = true WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_quiz_results(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION publish_quiz_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed boolean;
BEGIN
  SELECT results_confirmed INTO v_confirmed FROM quizzes WHERE id = p_quiz_id;
  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  IF NOT v_confirmed THEN
    RETURN jsonb_build_object('error', 'Results must be confirmed before publishing');
  END IF;
  UPDATE quizzes SET results_published = true WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_quiz_results(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION unpublish_quiz_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE quizzes
  SET results_published = false, results_confirmed = false
  WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION unpublish_quiz_results(uuid) TO authenticated;

INSERT INTO site_settings (id, portal_title, subtitle, description, contact_numbers, poster_url, primary_color, background_color, card_color, motivational_banner_url, motivational_quote, show_motivational_banner)
SELECT 1, 'Test your knowledge. Claim your rank.', 'Online Examination Portal', '40 questions. 40 minutes. Take the timed exam and check your results as soon as they are published.', '', '', '#1c4f9d', '#171918', '#2b312c', '', '', true
WHERE NOT EXISTS (
  SELECT 1 FROM site_settings WHERE id = 1
);
