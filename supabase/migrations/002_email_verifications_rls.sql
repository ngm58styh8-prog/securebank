-- GlobalVest: allow server-side verification API to manage codes.
-- The signup API runs on Vercel/Ruby only; this table is not queried from the browser.

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_verifications_server_access ON public.email_verifications;

CREATE POLICY email_verifications_server_access
  ON public.email_verifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.email_verifications TO anon, authenticated, service_role;
