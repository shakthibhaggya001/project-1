-- Restore the RPC that records a Top 10 student's uploaded photo URL.

DROP FUNCTION IF EXISTS public.update_photo_url(uuid, text, text, text);

CREATE FUNCTION public.update_photo_url(
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
  submission_id uuid;
  submission_rank int;
BEGIN
  SELECT s.id, s.rank
  INTO submission_id, submission_rank
  FROM public.submissions s
  JOIN public.quizzes q ON q.id = s.quiz_id
  WHERE s.quiz_id = p_quiz_id
    AND q.results_published = true
    AND s.status = 'submitted'
    AND s.normalized_whatsapp = regexp_replace(p_whatsapp_number, '[^0-9]', '', 'g')
    AND lower(trim(s.student_name)) = lower(trim(p_student_name))
  LIMIT 1;

  IF submission_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;

  IF submission_rank IS NULL OR submission_rank > 10 THEN
    RETURN jsonb_build_object('error', 'Only Top 10 students can upload photos');
  END IF;

  IF p_photo_url IS NULL OR trim(p_photo_url) = '' THEN
    RETURN jsonb_build_object('error', 'Photo URL is required');
  END IF;

  UPDATE public.submissions
  SET photo_url = p_photo_url,
      photo_uploaded_at = now()
  WHERE id = submission_id;

  RETURN jsonb_build_object('ok', true, 'submission_id', submission_id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_photo_url(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_photo_url(uuid, text, text, text)
TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
