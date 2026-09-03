/*
# Result Publication Workflow + Server Time + Top 10 Photos

## Overview
Implements a full result publication workflow (generate → confirm → publish),
server-authoritative exam timing, and Top 10 photo upload/storage.

## Changes
1. quizzes: + results_generated, results_confirmed columns
2. submissions: + attempt_started_at, photo_url, photo_uploaded_at columns
3. New RPC: get_server_time() — authoritative server timestamp
4. New RPC: start_exam_attempt() — server-time gated exam start
5. Updated generate_quiz_results — scores only, no auto-publish
6. New RPC: confirm_quiz_results
7. New RPC: publish_quiz_results
8. New RPC: unpublish_quiz_results
9. Replaced get_student_result — full result, whatsapp lookup, published-only
10. New RPC: verify_top10_and_get_upload_token
11. New RPC: update_photo_url
12. New RPC: get_published_top10 (admin)
13. Storage bucket: top10-photos with policies
14. Anon SELECT on submissions (for duplicate check)
*/

-- ============================================================
-- 1. Add columns to quizzes
-- ============================================================
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS results_generated boolean NOT NULL DEFAULT false;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS results_confirmed boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Add columns to submissions
-- ============================================================
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS photo_url text DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS photo_uploaded_at timestamptz;

-- ============================================================
-- 3. get_server_time
-- ============================================================
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT now(); $$;

GRANT EXECUTE ON FUNCTION get_server_time() TO anon, authenticated;

-- ============================================================
-- 4. start_exam_attempt
-- ============================================================
CREATE OR REPLACE FUNCTION start_exam_attempt(
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
  v_quiz quizzes%ROWTYPE;
  v_now timestamptz;
  v_existing int;
BEGIN
  SELECT * INTO v_quiz FROM quizzes WHERE id = p_quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  v_now := now();

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

  SELECT count(*)::int INTO v_existing
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_name = p_student_name
    AND whatsapp_number = p_whatsapp_number;

  IF v_existing > 0 THEN
    RETURN jsonb_build_object(
      'error', 'already_submitted',
      'message', 'You have already submitted this exam'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'server_time', v_now,
    'start_time', v_quiz.start_time,
    'end_time', v_quiz.end_time
  );
END;
$$;

GRANT EXECUTE ON FUNCTION start_exam_attempt(uuid, text, text) TO anon, authenticated;

-- ============================================================
-- 5. generate_quiz_results — score + rank only (no publish)
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

  UPDATE quizzes
  SET results_generated = true,
      results_confirmed = false,
      results_published = false
  WHERE id = p_quiz_id;

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

-- ============================================================
-- 6. confirm_quiz_results
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_quiz_results(p_quiz_id uuid)
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

  IF NOT v_quiz.results_generated THEN
    RETURN jsonb_build_object('error', 'Results must be generated first');
  END IF;

  UPDATE quizzes SET results_confirmed = true WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_quiz_results(uuid) TO authenticated;

-- ============================================================
-- 7. publish_quiz_results
-- ============================================================
CREATE OR REPLACE FUNCTION publish_quiz_results(p_quiz_id uuid)
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

  IF NOT v_quiz.results_confirmed THEN
    RETURN jsonb_build_object('error', 'Results must be confirmed before publishing');
  END IF;

  UPDATE quizzes SET results_published = true WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_quiz_results(uuid) TO authenticated;

-- ============================================================
-- 8. unpublish_quiz_results
-- ============================================================
CREATE OR REPLACE FUNCTION unpublish_quiz_results(p_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE quizzes
  SET results_published = false,
      results_confirmed = false
  WHERE id = p_quiz_id;

  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

GRANT EXECUTE ON FUNCTION unpublish_quiz_results(uuid) TO authenticated;

-- ============================================================
-- 9. Replace get_student_result (drop old first due to param rename)
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
BEGIN
  SELECT results_published INTO v_published FROM quizzes WHERE id = p_quiz_id;
  IF v_published IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  IF NOT v_published THEN
    RETURN jsonb_build_object('error', 'Results have not been published yet');
  END IF;

  SELECT * INTO v_sub
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_name = p_student_name
    AND whatsapp_number = p_whatsapp_number
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unable to find a published result with these details');
  END IF;

  SELECT count(*)::int INTO v_total_questions FROM questions WHERE quiz_id = p_quiz_id;
  SELECT count(*)::int INTO v_total_participants FROM submissions WHERE quiz_id = p_quiz_id;

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
-- 10. verify_top10_and_get_upload_token
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
BEGIN
  SELECT results_published INTO v_published FROM quizzes WHERE id = p_quiz_id;
  IF v_published IS NULL THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;

  IF NOT v_published THEN
    RETURN jsonb_build_object('error', 'Results have not been published yet');
  END IF;

  SELECT * INTO v_sub
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_name = p_student_name
    AND whatsapp_number = p_whatsapp_number
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
-- 11. update_photo_url
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
BEGIN
  SELECT * INTO v_sub
  FROM submissions
  WHERE quiz_id = p_quiz_id
    AND student_name = p_student_name
    AND whatsapp_number = p_whatsapp_number
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

-- ============================================================
-- 12. get_published_top10 (admin)
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
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_published_top10(uuid) TO authenticated;

-- ============================================================
-- 13. Storage bucket for Top 10 photos
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('top10-photos', 'top10-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "top10_photos_read" ON storage.objects;
CREATE POLICY "top10_photos_read" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'top10-photos');

DROP POLICY IF EXISTS "top10_photos_upload" ON storage.objects;
CREATE POLICY "top10_photos_upload" ON storage.objects FOR INSERT
  TO anon, authenticated WITH CHECK (bucket_id = 'top10-photos');

DROP POLICY IF EXISTS "top10_photos_update" ON storage.objects;
CREATE POLICY "top10_photos_update" ON storage.objects FOR UPDATE
  TO anon, authenticated USING (bucket_id = 'top10-photos') WITH CHECK (bucket_id = 'top10-photos');

-- ============================================================
-- 14. Allow anon to check for existing submissions
-- ============================================================
DROP POLICY IF EXISTS "read_own_submission_check" ON submissions;
CREATE POLICY "read_own_submission_check" ON submissions FOR SELECT
  TO anon, authenticated USING (true);
