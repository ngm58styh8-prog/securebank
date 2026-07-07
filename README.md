# GlobalVest

Demo online banking app (static frontend + local Python server).

## Run locally

```bash
./start.sh
```

- User site: http://localhost:8765/index.html (landing)
- Sign in: http://localhost:8765/login.html
- Admin login: http://localhost:8765/admin.html (direct URL only — not linked from the user site)

**Important:** Run the app with `./start.sh` so accounts sync to the server registry at `data/accounts.json`. Registration and admin both read from this shared registry (plus browser cache). Do not open HTML files directly via `file://`.

## Back up before moving to a new host

```bash
./backup.sh
```

Creates `backups/globalvest-YYYYMMDD-HHMMSS/` with:

- `accounts.json` — all user accounts
- `admin.json` — admin settings, pending deposits/transfers, activity log
- `email.config.json` — SMTP settings (if present)

On the **new host**, copy the project and backup folder, then:

```bash
./restore.sh backups/globalvest-YYYYMMDD-HHMMSS
./start.sh
```

Open http://localhost:8765/admin.html — all users and admin data load from the restored server files.

## Email verification (Resend + Supabase on Vercel)

Signup sends a real 6-digit verification code via **Resend**. Codes are stored in **Supabase** and expire after 10 minutes.

### 1. Supabase migration

Run the SQL in [supabase/migrations/001_email_verifications.sql](supabase/migrations/001_email_verifications.sql) in the Supabase SQL Editor (creates `email_verifications` table).

### 2. Vercel environment variables

Set in **Project Settings → Environment Variables** (never expose service keys to the frontend):

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key (already added) |
| `RESEND_FROM_EMAIL` | Verified sender, e.g. `GlobalVest <noreply@yourdomain.com>` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | New secret API key (`sb_secret_...`, server-side only) |
| `SUPABASE_SECRET_KEYS` | Optional JSON map of named secret keys, e.g. `{"default":"sb_secret_..."}` |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy service role JWT (alternative to secret key) |

### 3. Deploy

```bash
npm install
vercel deploy
```

Or connect the GitHub repo to Vercel for automatic deploys.

### 4. Local API testing

```bash
cp .env.example .env.local   # fill in Supabase + Resend values
npm install
./start.sh                   # Ruby server now includes /api/send-verification routes
# OR
npx vercel dev
```

Check configuration:

```bash
curl http://localhost:8765/api/verification-health
curl https://your-app.vercel.app/api/registry-health
npm run verify:check
```

Send a test code:

```bash
node scripts/verify-email-setup.mjs you@example.com
# then verify:
node scripts/verify-email-setup.mjs you@example.com 123456
```

API routes (server-only — `RESEND_API_KEY` never sent to browser):

- `POST /api/send-verification` — send code on signup
- `POST /api/resend-verification` — resend with 60s cooldown
- `POST /api/verify-email` — validate code

## Admin panel

Open the admin console at **`/admin.html`** (not linked from the public user site).

**Credentials:** `admin@globalvest.com` / `admin123`

Local: `./start.sh` → http://localhost:8765/admin.html

Production: https://globalvestbank.com/admin.html (also https://securebank-1.vercel.app/admin.html — same shared registry)

### Shared user registry (required for production admin)

On Vercel, user accounts and admin data sync to **Supabase** (not browser-only storage). One-time setup:

1. Run [supabase/migrations/002_app_registry.sql](supabase/migrations/002_app_registry.sql) in the Supabase SQL Editor (creates `user_accounts` and `admin_registry` tables).
2. Ensure Vercel has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (same vars as email verification).
3. Redeploy, then verify:

```bash
curl https://your-app.vercel.app/api/registry-health
```

When `ok: true` and `tableReady: true`, users who sign up on Vercel are visible in the admin dashboard from any browser. Open admin → **Repair registry** to pull server accounts and link them all to the user list.

**Local dev** uses `data/accounts.json` via `./start.sh`. Copy `data/accounts.example.json` to `data/accounts.json` for sample users (e.g. `ellenmartinez20011@hotmail.com`).

## Email notifications (deposits & withdrawals)

Users receive real emails (and in-app Profile inbox copies) when:

| Event | Trigger |
|--------|---------|
| Deposit submitted | User submits a deposit |
| Deposit approved | Admin approves |
| Deposit rejected | Admin rejects |
| Withdrawal submitted | User requests a transfer |
| Withdrawal approved | Admin approves |
| Withdrawal rejected | Admin rejects |

SMTP must be configured and the app must run via `./start.sh`.

1. Copy the example config:
   ```bash
   cp email.config.example.json email.config.json
   ```
2. Edit `email.config.json` with your SMTP credentials (Gmail app password, SendGrid SMTP, etc.).
3. Restart `./start.sh`.

Deposit and withdrawal emails are also saved to the user's Profile inbox in the app.
