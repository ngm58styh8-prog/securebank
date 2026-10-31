# GlobalVest Google & Apple sign-in

OAuth uses **Supabase Auth** for identity only. Accounts still live in the existing `user_accounts` registry.

## 1. Supabase

1. **Authentication → Providers** — enable **Google** and **Apple** with your OAuth client IDs/secrets.
2. **Authentication → URL configuration** — add redirect URL:
   - `https://globalvestbank.com/auth/callback`
   - `http://localhost:8765/auth/callback` (local `./start.sh`)
3. Copy **Project URL** → `SUPABASE_URL`
4. Copy **anon public** key → `SUPABASE_ANON_KEY` (never use the service role key in the browser)

## 2. Vercel environment

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Same as email/registry |
| `SUPABASE_ANON_KEY` | Browser OAuth (publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server registry + `/api/oauth-complete` |

Redeploy after setting variables.

## 3. Behavior

- **New OAuth user** — server creates a registry account with `profile.oauthProviders` set; email marked verified.
- **Existing email/password user** — OAuth does **not** auto-link (sign in with email first).
- **Returning OAuth user** — provider ID must match stored `oauthProviders`.

## 4. Verify

```bash
curl https://globalvestbank.com/api/oauth-config
# configured: true when SUPABASE_URL + SUPABASE_ANON_KEY are set
```

Buttons stay disabled with a notice until configuration is complete.
