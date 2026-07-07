# Email Deliverability Report — GlobalVest Bank

Verification codes are sent via **Resend** from the server (`server-lib/resend.js`). This document covers inbox placement, DNS authentication, and production configuration.

## Current issues found (production audit)

| Issue | Severity | Fix |
|-------|----------|-----|
| `RESEND_FROM_EMAIL` was `support@globalvestbank.com` | **High** | Use `GlobalVest Bank <noreply@globalvestbank.com>` for From; keep `support@` as Reply-To only |
| Missing display name on From address | Medium | Always use `GlobalVest Bank <noreply@globalvestbank.com>` |
| Plain-text-only template (previous) | Medium | Now sends HTML + text multipart |
| No physical footer (CAN-SPAM) | Medium | Added postal line via `RESEND_PHYSICAL_ADDRESS` |
| DMARC record may be missing at registrar | High | Add `_dmarc.globalvestbank.com` TXT (see below) |
| List-Unsubscribe on OTP mail | N/A | **Not used** — security codes are transactional, not bulk/marketing |

Run live checks:

```bash
npm run email:report
curl https://globalvestbank.com/api/verification-health
```

## Required Vercel environment variables

| Variable | Required | Production value |
|----------|----------|------------------|
| `RESEND_API_KEY` | Yes | `re_...` from Resend dashboard |
| `RESEND_FROM_EMAIL` | Yes | `GlobalVest Bank <noreply@globalvestbank.com>` |
| `RESEND_REPLY_TO` | Yes | `support@globalvestbank.com` |
| `RESEND_SITE_URL` | Yes | `https://globalvestbank.com` |
| `RESEND_PHYSICAL_ADDRESS` | Optional | Physical postal line for email footer |

**Never** set `RESEND_SITE_URL` to `localhost`, `127.0.0.1`, or `*.vercel.app` — the code falls back to `https://globalvestbank.com` if detected.

## DNS records (SPF, DKIM, DMARC)

Add **globalvestbank.com** in [Resend → Domains](https://resend.com/domains). Copy exact values from the Resend **Records** tab (do not guess SPF/DKIM values).

### SPF

| Type | Host | Purpose |
|------|------|---------|
| TXT | `globalvestbank.com` | Authorizes Resend to send for your domain |

Example shape (use Resend's exact value):

```txt
v=spf1 include:amazonses.com ~all
```

### DKIM

| Type | Host | Purpose |
|------|------|---------|
| CNAME or TXT | `resend._domainkey.globalvestbank.com` (exact name from Resend) | Signs outbound mail so Gmail/Outlook trust your domain |

Resend uses 1024-bit DKIM keys (RFC-compliant). Add every record Resend lists until domain status is **Verified**.

### DMARC (recommended — often missing)

| Type | Host | Value |
|------|------|-------|
| TXT | `_dmarc.globalvestbank.com` | `v=DMARC1; p=none; rua=mailto:dmarc@globalvestbank.com; fo=1` |

After 2–4 weeks of clean sending with aligned SPF/DKIM, tighten policy:

1. `p=quarantine`
2. Later `p=reject` for maximum protection

### Authentication alignment

| Check | Requirement |
|-------|-------------|
| **From header** | `noreply@globalvestbank.com` |
| **Reply-To** | `support@globalvestbank.com` (same domain, different mailbox) |
| **DKIM d=** | `globalvestbank.com` (when domain verified in Resend) |
| **SPF** | Pass via Resend return-path on verified domain |
| **DMARC** | From domain aligns with DKIM signing domain |

## Email headers (verification mail)

| Header | Value | Why |
|--------|-------|-----|
| `From` | `GlobalVest Bank <noreply@globalvestbank.com>` | Brand + verified domain |
| `Reply-To` | `support@globalvestbank.com` | Users reply to support, not noreply |
| `Organization` | `GlobalVest Bank` | Identifies sender organization |
| `Message-ID` | `<gv-verify-...@globalvestbank.com>` | Domain-aligned unique ID |
| `X-Entity-Ref-ID` | Per-recipient ref | Prevents Gmail threading duplicate codes |
| `X-Auto-Response-Suppress` | `All` | Reduces auto-reply loops |
| `List-Unsubscribe` | *Omitted* | Not applicable for one-time security OTP |

## Template improvements (spam-filter safe)

- Subject: **Your GlobalVest Bank sign-in code** (no "URGENT", "FREE", "VERIFY NOW")
- Multipart **HTML + plain text** with matching content
- Semantic `<header>`, `<main>`, `<footer>` inside table layout
- Hidden preheader for inbox preview
- No images, tracking pixels, or URL shorteners
- Single link: `https://globalvestbank.com/login.html`
- Physical address in footer
- Support email and website in footer

## Code architecture

```
server-lib/email-config.json       ← brand constants (shared)
server-lib/email-deliverability.js ← template, headers, DNS report, warnings
server-lib/resend.js               ← sendTransactionalEmail() / sendVerificationEmail()
lib/email_deliverability.rb        ← Ruby mirror for ./start.sh local server
lib/email_verification.rb          ← calls EmailDeliverability + Resend API
api/verification-health.js         ← exposes full deliverability report JSON
```

## Security

- `RESEND_API_KEY` is server-only (Vercel env, never in browser)
- Verification codes expire in 10 minutes
- No open/click tracking on verification emails
- Registration/auth logic unchanged — only mail transport and templates

## Inbox placement recommendations

1. Fix Vercel `RESEND_FROM_EMAIL` to `noreply@` (not `support@`)
2. Verify domain in Resend until SPF + DKIM show **Verified**
3. Add DMARC TXT at `_dmarc.globalvestbank.com`
4. Send test to Gmail + Outlook; mark **Not spam** once to train filters
5. Avoid sudden volume spikes on a new domain
6. Monitor bounces in Resend dashboard
