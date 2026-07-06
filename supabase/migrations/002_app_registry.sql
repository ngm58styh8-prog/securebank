-- GlobalVest shared account + admin registry (Vercel serverless sync)
-- Run in Supabase SQL Editor. Access is server-side only via service role.

CREATE TABLE IF NOT EXISTS public.user_accounts (
  email TEXT PRIMARY KEY,
  account JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_accounts_updated_idx
  ON public.user_accounts (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_registry (
  id TEXT PRIMARY KEY DEFAULT 'default',
  admin JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_accounts IS
  'GlobalVest user account blobs synced from the app (service role writes only)';
COMMENT ON TABLE public.admin_registry IS
  'GlobalVest admin settings, pending requests, and activity (service role writes only)';
