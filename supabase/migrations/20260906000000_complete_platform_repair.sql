-- Final compatibility repair for the complete quiz platform.
-- Run this after 20260905000000_fix_missing_platform_schema.sql.

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS results_generated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS results_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS results_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicated_from uuid;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS marks int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS question_snapshot jsonb DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.get_quiz_question_count(p_quiz_id uuid)
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT count(*)::int FROM questions WHERE quiz_id = p_quiz_id; $$;
GRANT EXECUTE ON FUNCTION public.get_quiz_question_count(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.duplicate_quiz(p_source_quiz_id uuid, p_new_title text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  source_quiz quizzes%ROWTYPE;
  new_id uuid := gen_random_uuid();
  new_title text;
  copied_count int;
BEGIN
  SELECT * INTO source_quiz FROM quizzes WHERE id = p_source_quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Source quiz not found'); END IF;
  new_title := COALESCE(NULLIF(trim(p_new_title), ''), source_quiz.title || ' (Copy)');
  INSERT INTO quizzes (id, title, description, quiz_date, start_time, end_time, duplicated_from)
  VALUES (new_id, new_title, source_quiz.description, source_quiz.quiz_date, source_quiz.start_time, source_quiz.end_time, p_source_quiz_id);
  INSERT INTO questions (quiz_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer)
  SELECT new_id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer
  FROM questions WHERE quiz_id = p_source_quiz_id ORDER BY question_number;
  SELECT count(*)::int INTO copied_count FROM questions WHERE quiz_id = new_id;
  RETURN jsonb_build_object('ok', true, 'new_quiz_id', new_id, 'new_title', new_title, 'questions_copied', copied_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.duplicate_quiz(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_student_result(uuid, text, text);
CREATE OR REPLACE FUNCTION public.get_student_result(p_quiz_id uuid, p_student_name text, p_whatsapp_number text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  submission_row submissions%ROWTYPE;
  published boolean;
  total_questions int;
  total_participants int;
  answered int;
  unanswered int;
BEGIN
  SELECT results_published INTO published FROM quizzes WHERE id = p_quiz_id;
  IF published IS NULL THEN RETURN jsonb_build_object('error', 'Quiz not found'); END IF;
  IF NOT published THEN RETURN jsonb_build_object('error', 'Results have not been published yet'); END IF;
  SELECT * INTO submission_row FROM submissions
  WHERE quiz_id = p_quiz_id
    AND normalized_whatsapp = regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g')
    AND lower(trim(student_name)) = lower(trim(p_student_name))
    AND status = 'submitted' LIMIT 1;
  IF submission_row.id IS NULL THEN RETURN jsonb_build_object('error', 'Unable to find a published result with these details'); END IF;
  SELECT count(*)::int INTO total_questions FROM questions WHERE quiz_id = p_quiz_id;
  SELECT count(*)::int INTO total_participants FROM submissions WHERE quiz_id = p_quiz_id AND status = 'submitted';
  SELECT count(*)::int INTO answered FROM jsonb_object_keys(COALESCE(submission_row.answers, '{}'::jsonb));
  unanswered := GREATEST(total_questions - answered, 0);
  RETURN jsonb_build_object(
    'score', submission_row.score, 'rank', submission_row.rank, 'total_participants', total_participants,
    'total_questions', total_questions, 'correct', submission_row.score,
    'incorrect', GREATEST(total_questions - submission_row.score - unanswered, 0), 'unanswered', unanswered,
    'percentage', round((submission_row.score::numeric / greatest(total_questions, 1)) * 100, 1),
    'student_name', submission_row.student_name, 'school_name', submission_row.school_name,
    'grade', submission_row.grade, 'is_top_10', (submission_row.rank IS NOT NULL AND submission_row.rank <= 10),
    'photo_url', COALESCE(submission_row.photo_url, ''), 'time_taken_seconds', submission_row.time_taken_seconds,
    'submitted_at', submission_row.submitted_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_result(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_published_top10(p_quiz_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'rank', s.rank, 'student_name', s.student_name, 'school_name', s.school_name,
    'grade', s.grade, 'whatsapp_number', s.whatsapp_number, 'score', s.score, 'photo_url', COALESCE(s.photo_url, '')
  ) ORDER BY s.rank), '[]'::jsonb)
  FROM submissions s JOIN quizzes q ON q.id = s.quiz_id
  WHERE s.quiz_id = p_quiz_id AND q.results_published = true AND s.status = 'submitted' AND s.rank BETWEEN 1 AND 10;
$$;
GRANT EXECUTE ON FUNCTION public.get_published_top10(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_top10_and_get_upload_token(p_quiz_id uuid, p_student_name text, p_whatsapp_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE submission_row submissions%ROWTYPE;
BEGIN
  SELECT s.* INTO submission_row FROM submissions s JOIN quizzes q ON q.id = s.quiz_id
  WHERE s.quiz_id = p_quiz_id AND q.results_published = true AND s.status = 'submitted'
    AND s.normalized_whatsapp = regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g')
    AND lower(trim(s.student_name)) = lower(trim(p_student_name)) LIMIT 1;
  IF submission_row.id IS NULL THEN RETURN jsonb_build_object('error', 'Unable to find a published result with these details'); END IF;
  IF submission_row.rank IS NULL OR submission_row.rank > 10 THEN RETURN jsonb_build_object('error', 'not_top_10', 'rank', submission_row.rank); END IF;
  RETURN jsonb_build_object('ok', true, 'submission_id', submission_row.id, 'rank', submission_row.rank, 'quiz_id', p_quiz_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_top10_and_get_upload_token(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_photo_url(p_quiz_id uuid, p_student_name text, p_whatsapp_number text, p_photo_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE submission_id uuid; submission_rank int;
BEGIN
  SELECT s.id, s.rank INTO submission_id, submission_rank FROM submissions s JOIN quizzes q ON q.id = s.quiz_id
  WHERE s.quiz_id = p_quiz_id AND q.results_published = true AND s.status = 'submitted'
    AND s.normalized_whatsapp = regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g')
    AND lower(trim(s.student_name)) = lower(trim(p_student_name)) LIMIT 1;
  IF submission_id IS NULL THEN RETURN jsonb_build_object('error', 'Submission not found'); END IF;
  IF submission_rank IS NULL OR submission_rank > 10 THEN RETURN jsonb_build_object('error', 'Only Top 10 students can upload photos'); END IF;
  UPDATE submissions SET photo_url = p_photo_url, photo_uploaded_at = now() WHERE id = submission_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_photo_url(uuid, text, text, text) TO anon, authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('top10-photos', 'top10-photos', true)
ON CONFLICT (id) DO NOTHING;
