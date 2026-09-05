-- Server-verified admin access code bootstrap.
-- The code is stored as a SHA-256 digest, never exposed to the client by SQL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.admin_access_codes (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_access_codes (id, code_hash)
VALUES (1, encode(digest(lower(trim('admin 0000')), 'sha256'), 'hex'))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_access_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_access_codes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_admin_access(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'You must sign in first');
  END IF;

  SELECT code_hash INTO expected_hash
  FROM public.admin_access_codes
  WHERE id = 1;

  IF expected_hash IS NULL
     OR encode(digest(lower(trim(COALESCE(p_code, ''))), 'sha256'), 'hex') <> expected_hash THEN
    RETURN jsonb_build_object('error', 'Invalid admin access code');
  END IF;

  INSERT INTO public.admin_users (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_admin_access(text) TO authenticated;
