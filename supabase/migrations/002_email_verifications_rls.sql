-- GlobalVest: server-side email verification access (RLS-safe)
-- Ensures signup API can write codes using service role / secret keys or RPC fallback.

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_verifications_service_role_all ON public.email_verifications;
DROP POLICY IF EXISTS email_verifications_server_all ON public.email_verifications;

-- Block direct table access from browser roles; service_role / secret keys bypass RLS.
REVOKE ALL ON TABLE public.email_verifications FROM anon, authenticated;
GRANT ALL ON TABLE public.email_verifications TO service_role;

CREATE OR REPLACE FUNCTION public.globalvest_delete_unverified(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.email_verifications
  WHERE email = lower(trim(p_email))
    AND verified = false;
END;
$$;

CREATE OR REPLACE FUNCTION public.globalvest_insert_verification(
  p_email text,
  p_code text,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.email_verifications (email, code, expires_at, verified)
  VALUES (lower(trim(p_email)), p_code, p_expires_at, false)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.globalvest_get_latest_verification(p_email text)
RETURNS SETOF public.email_verifications
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT *
  FROM public.email_verifications
  WHERE email = lower(trim(p_email))
  ORDER BY created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.globalvest_get_unverified(p_email text)
RETURNS SETOF public.email_verifications
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT *
  FROM public.email_verifications
  WHERE email = lower(trim(p_email))
    AND verified = false
  ORDER BY created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.globalvest_mark_verified(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_verifications
  SET verified = true
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.globalvest_delete_unverified(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.globalvest_insert_verification(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.globalvest_get_latest_verification(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.globalvest_get_unverified(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.globalvest_mark_verified(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.globalvest_delete_unverified(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.globalvest_insert_verification(text, text, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.globalvest_get_latest_verification(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.globalvest_get_unverified(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.globalvest_mark_verified(uuid) TO anon, authenticated, service_role;
