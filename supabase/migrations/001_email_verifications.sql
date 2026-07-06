-- GlobalVest email verification codes (Resend + Supabase)
-- Run in Supabase SQL Editor or via Supabase CLI: supabase db push

CREATE TABLE IF NOT EXISTS public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verifications_email_idx
  ON public.email_verifications (email);

CREATE INDEX IF NOT EXISTS email_verifications_lookup_idx
  ON public.email_verifications (email, verified, expires_at DESC);

COMMENT ON TABLE public.email_verifications IS
  'One-time 6-digit email verification codes for GlobalVest signup';
