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
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | **Verified** sender on your domain — `GlobalVest Bank <noreply@globalvestbank.com>` (not `onboarding@resend.dev`) |
| `RESEND_REPLY_TO` | Optional support inbox — `support@globalvestbank.com` |
| `RESEND_SITE_URL` | Optional site link in email — `https://globalvestbank.com` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | New secret API key (`sb_secret_...`, server-side only) |
| `SUPABASE_SECRET_KEYS` | Optional JSON map of named secret keys, e.g. `{"default":"sb_secret_..."}` |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy service role JWT (alternative to secret key) |

### 2b. Inbox delivery (avoid spam/junk)

Verification emails land in spam when sent from Resend’s sandbox domain. Fix it once in Resend + DNS:

1. In [Resend → Domains](https://resend.com/domains), add **globalvestbank.com**.
2. Add the **SPF** and **DKIM** DNS records Resend shows (at your domain registrar or Cloudflare).
3. Wait until Resend shows the domain as **Verified**.
4. In Vercel, set `RESEND_FROM_EMAIL` to `GlobalVest Bank <noreply@globalvestbank.com>` and redeploy.
5. Confirm with:

```bash
curl https://globalvestbank.com/api/verification-health
# inboxReady should be true; deliverabilityWarnings should be []
```

Emails are sent as multipart HTML + plain text with a reply-to address and branded template (see `server-lib/email-deliverability.js`).

Full deliverability audit: [docs/EMAIL_DELIVERABILITY.md](docs/EMAIL_DELIVERABILITY.md)

```bash
npm run email:report
```

### 3. Deploy

```bash
npm install
vercel deploy
```

Or connect the GitHub repo to Vercel for automatic deploys.

### 4. Local API testing

```bash
npm run setup:env              # creates .env.local from .env.example
# Edit .env.local with Supabase + Resend values, or:
# npx vercel env pull .env.local
npm install
./start.sh                   # Ruby server now includes /api/send-verification routes
# OR
npx vercel dev
```

Check configuration:

```bash
npm run error-check
npm run check:registry
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

Open admin on **globalvestbank.com** so it reads the same Supabase registry as user signups. On login the panel auto-syncs server accounts; use **Repair registry** to refresh manually.

### Shared user registry (required for production admin)

On Vercel, user accounts and admin data sync to **Supabase** (not browser-only storage). One-time setup:

1. Apply migrations: set `SUPABASE_URL` and `SUPABASE_DB_PASSWORD` in `.env.local`, then run `npm run supabase:push` (links the CLI and runs `supabase db push`). Or run each file under [supabase/migrations/](supabase/migrations/) in the Supabase SQL Editor (start with `002_app_registry.sql` for `user_accounts` and `admin_registry`).
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

## Investment confirmation emails

When a customer successfully opens an investment (Gold plan or any market-asset plan), the server commits the investment first and then queues a **GlobalVest | Investment Confirmation** email through the existing Resend integration (`server-lib/resend.js`). Nothing is sent for pending or failed purchases, or to unverified customer emails.

| Piece | Where |
|-------|-------|
| Queue, retries, idempotency, webhooks | `server-lib/investment-confirmation-emails.js` |
| HTML + plain-text template | `server-lib/investment-confirmation-template.js` |
| Table | `supabase/migrations/008_investment_email_notifications.sql` |
| Retry worker (Vercel cron, every 5 min) | `api/cron/investment-emails.js` |
| Provider webhook | `api/resend-webhook.js` |
| Admin API | `api/investment-emails.js` |
| Admin screen | Admin dashboard → **Investment Emails** |

How it behaves:

- Idempotency key is `investment_id:investment_confirmation`; a second call for the same investment never creates a second email or a second investment.
- First attempt happens inline. Temporary errors (5xx, rate limit, network) are retried after 1, 5, 15 and 60 minutes (5 attempts total). Permanent errors fail immediately.
- When retries are exhausted the row becomes **Failed**, the failure reason is stored, and an alert is emailed to `INVESTMENT_EMAIL_ADMIN_ALERT_TO` (if set).
- Admins can retry **Failed** rows from the dashboard. A retry re-uses the same record and never touches the investment.
- Resend webhooks (`email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`) move the status to Sent / Delivered / Deferred / Bounced / Failed. Signatures are verified (Svix HMAC, 5-minute tolerance) and late events never downgrade a status.
- Duration, hourly, total and total-value figures come from the plan stored with the investment (`hourly = daily / 24`, `total = daily x durationDays`). They are labelled simulated, not guaranteed.

Required configuration (Vercel → Environment Variables):

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Already set |
| `INVESTMENT_EMAIL_FROM` | Optional. Defaults to `GlobalVest Investments <investments@globalvestbank.com>`; must be on the verified Resend domain or it falls back to the default sender |
| `RESEND_WEBHOOK_SECRET` | `whsec_...` from Resend → Webhooks (endpoint `https://globalvestbank.com/api/resend-webhook`) |
| `INVESTMENT_EMAIL_ADMIN_ALERT_TO` | Comma-separated alert inboxes |
| `CRON_SECRET` | Lets Vercel cron authenticate to `/api/cron/*` |

Tests (stubbed provider, temp data directory, no real email):

```bash
npm run test:investment-emails
```

Verifying real delivery: place a test investment with an account whose email you control, then confirm the row in **Investment Emails** moves to **Delivered** (that status only comes from Resend's `email.delivered` webhook), and check the received message's headers for `spf=pass`, `dkim=pass`, `dmarc=pass`.
