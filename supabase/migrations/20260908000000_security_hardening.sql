-- Security hardening for production Supabase deployments.
-- Bootstrap an administrator by inserting their Auth user id into admin_users
-- from the Supabase SQL editor after signup:
-- INSERT INTO public.admin_users (user_id) SELECT id FROM auth.users WHERE email = 'admin@example.com';

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

DROP POLICY IF EXISTS "admin_users_self_read" ON public.admin_users;
CREATE POLICY "admin_users_self_read" ON public.admin_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Public quiz metadata is safe; administration requires the allowlist.
DROP POLICY IF EXISTS "insert_quizzes" ON public.quizzes;
DROP POLICY IF EXISTS "update_quizzes" ON public.quizzes;
DROP POLICY IF EXISTS "delete_quizzes" ON public.quizzes;
CREATE POLICY "insert_quizzes" ON public.quizzes
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "update_quizzes" ON public.quizzes
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "delete_quizzes" ON public.quizzes
  FOR DELETE TO authenticated USING (public.is_admin());

-- Answer keys are never directly readable by anonymous clients.
DROP POLICY IF EXISTS "read_questions" ON public.questions;
DROP POLICY IF EXISTS "insert_questions" ON public.questions;
DROP POLICY IF EXISTS "update_questions" ON public.questions;
DROP POLICY IF EXISTS "delete_questions" ON public.questions;
CREATE POLICY "read_questions_admin" ON public.questions
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "insert_questions_admin" ON public.questions
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "update_questions_admin" ON public.questions
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "delete_questions_admin" ON public.questions
  FOR DELETE TO authenticated USING (public.is_admin());

-- Students and submissions are accessed through SECURITY DEFINER RPCs only.
DROP POLICY IF EXISTS "select_students" ON public.students;
DROP POLICY IF EXISTS "insert_students" ON public.students;
DROP POLICY IF EXISTS "update_students" ON public.students;
DROP POLICY IF EXISTS "insert_submissions" ON public.submissions;
DROP POLICY IF EXISTS "read_submissions" ON public.submissions;
DROP POLICY IF EXISTS "update_submissions" ON public.submissions;
DROP POLICY IF EXISTS "delete_submissions" ON public.submissions;
DROP POLICY IF EXISTS "read_own_submission_check" ON public.submissions;
CREATE POLICY "students_admin_only" ON public.students
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "submissions_admin_only" ON public.submissions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "write_site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "update_site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "admin_insert_site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "admin_update_site_settings" ON public.site_settings;
CREATE POLICY "write_site_settings_admin" ON public.site_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "update_site_settings_admin" ON public.site_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Student clients receive question text and options, never correct_answer.
CREATE OR REPLACE FUNCTION public.get_exam_questions(p_quiz_id uuid)
RETURNS TABLE (
  id uuid,
  quiz_id uuid,
  question_number int,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.quiz_id, q.question_number, q.question_text,
         q.option_a, q.option_b, q.option_c, q.option_d
  FROM public.questions q
  JOIN public.quizzes z ON z.id = q.quiz_id
  WHERE q.quiz_id = p_quiz_id
    AND now() >= z.start_time
    AND now() <= z.end_time
  ORDER BY q.question_number;
$$;

REVOKE ALL ON FUNCTION public.get_exam_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid) TO anon, authenticated;

-- Ensure student workflow functions remain callable without table grants.
GRANT EXECUTE ON FUNCTION public.start_or_resume_attempt(uuid, text, text, int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_answer_progress(uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid, jsonb) TO anon, authenticated;

-- Limit photo writes to the UUID path of a published Top-10 submission.
CREATE OR REPLACE FUNCTION public.can_upload_top10_photo(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submission_id uuid;
BEGIN
  IF p_path !~ '^[0-9a-fA-F-]{36}/photo\.(jpg|jpeg|png|webp)$' THEN
    RETURN false;
  END IF;
  submission_id := split_part(p_path, '/', 1)::uuid;
  RETURN EXISTS (
    SELECT 1
    FROM public.submissions s
    JOIN public.quizzes q ON q.id = s.quiz_id
    WHERE s.id = submission_id
      AND s.status = 'submitted'
      AND s.rank BETWEEN 1 AND 10
      AND q.results_published = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_upload_top10_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_upload_top10_photo(text) TO anon, authenticated;

DROP POLICY IF EXISTS "top10_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "top10_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "top10_photos_delete" ON storage.objects;
CREATE POLICY "top10_photos_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'top10-photos' AND public.can_upload_top10_photo(name));
CREATE POLICY "top10_photos_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'top10-photos' AND public.can_upload_top10_photo(name))
  WITH CHECK (bucket_id = 'top10-photos' AND public.can_upload_top10_photo(name));

-- SECURITY DEFINER functions must enforce admin authorization themselves.
CREATE OR REPLACE FUNCTION public.generate_quiz_results(p_quiz_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE total_participants int; top_score int;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Admin access required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN
    RETURN jsonb_build_object('error', 'Quiz not found');
  END IF;
  WITH scored AS (
    SELECT s.id,
      (SELECT count(*)::int FROM questions q
       WHERE q.quiz_id = s.quiz_id
         AND upper(q.correct_answer::text) = upper(COALESCE(s.answers ->> q.question_number::text, ''))) AS score,
      s.submitted_at
    FROM submissions s
    WHERE s.quiz_id = p_quiz_id AND s.status = 'submitted'
  ), ranked AS (
    SELECT id, score, rank() OVER (ORDER BY score DESC, submitted_at ASC) AS result_rank
    FROM scored
  )
  UPDATE submissions s SET score = ranked.score, rank = ranked.result_rank
  FROM ranked WHERE s.id = ranked.id;
  UPDATE submissions SET rank = NULL WHERE quiz_id = p_quiz_id AND status <> 'submitted';
  UPDATE quizzes SET results_generated = true, results_confirmed = false, results_published = false WHERE id = p_quiz_id;
  SELECT count(*)::int INTO total_participants FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';
  SELECT COALESCE(max(score), 0) INTO top_score FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';
  RETURN jsonb_build_object('total_participants', total_participants, 'top_score', top_score, 'quiz_id', p_quiz_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_quiz_results(p_quiz_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Admin access required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN RETURN jsonb_build_object('error', 'Quiz not found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id AND results_generated = true) THEN
    RETURN jsonb_build_object('error', 'Results must be generated first');
  END IF;
  UPDATE quizzes SET results_confirmed = true WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_quiz_results(p_quiz_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Admin access required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id) THEN RETURN jsonb_build_object('error', 'Quiz not found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_quiz_id AND results_confirmed = true) THEN
    RETURN jsonb_build_object('error', 'Results must be confirmed before publishing');
  END IF;
  UPDATE quizzes SET results_published = true WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_quiz_results(p_quiz_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Admin access required'); END IF;
  UPDATE quizzes SET results_published = false, results_confirmed = false WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.duplicate_quiz(p_source_quiz_id uuid, p_new_title text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE source_quiz quizzes%ROWTYPE; new_id uuid := gen_random_uuid(); new_title text; copied_count int;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Admin access required'); END IF;
  SELECT * INTO source_quiz FROM quizzes WHERE id = p_source_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Source quiz not found'); END IF;
  new_title := COALESCE(NULLIF(trim(p_new_title), ''), source_quiz.title || ' (Copy)');
  INSERT INTO quizzes (id, title, description, quiz_date, start_time, end_time, duplicated_from)
  VALUES (new_id, new_title, source_quiz.description, source_quiz.quiz_date, source_quiz.start_time, source_quiz.end_time, p_source_quiz_id);
  INSERT INTO questions (quiz_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer)
  SELECT new_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer
  FROM questions WHERE quiz_id = p_source_quiz_id ORDER BY question_number;
  SELECT count(*)::int INTO copied_count FROM questions WHERE quiz_id = new_id;
  RETURN jsonb_build_object('ok', true, 'new_quiz_id', new_id, 'questions_copied', copied_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_published_top10(p_quiz_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN public.is_admin() THEN COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'rank', s.rank, 'student_name', s.student_name, 'school_name', s.school_name,
    'grade', s.grade, 'whatsapp_number', s.whatsapp_number, 'score', s.score, 'photo_url', COALESCE(s.photo_url, '')
  ) ORDER BY s.rank), '[]'::jsonb) ELSE jsonb_build_object('error', 'Admin access required') END
  FROM submissions s WHERE s.quiz_id = p_quiz_id AND s.status = 'submitted' AND s.rank BETWEEN 1 AND 10;
$$;
