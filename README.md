# SecureBank

Demo online banking app (static frontend + local Python server).

## Run locally

```bash
./start.sh
```

- User site: http://localhost:8765/index.html (landing)
- Sign in: http://localhost:8765/login.html
- Admin login: http://localhost:8765/admin.html (direct URL only — not linked from the user site)

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
