# SecureBank

Demo online banking app (static frontend + local Python server).

## Run locally

```bash
./start.sh
```

- User login: http://localhost:8765/index.html
- Admin login: http://localhost:8765/admin.html (`admin@securebank.com` / `admin123`)

## Deposit email notifications

When an admin approves a deposit, the user receives a real email if SMTP is configured.

1. Copy the example config:
   ```bash
   cp email.config.example.json email.config.json
   ```
2. Edit `email.config.json` with your SMTP credentials (Gmail app password, SendGrid SMTP, etc.).
3. Restart `./start.sh`.

Deposit emails are also saved to the user's Profile inbox in the app.
