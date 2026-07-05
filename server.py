#!/usr/bin/env python3
"""SecureBank static server with deposit email notifications."""

import json
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "email.config.json"
PORT = int(os.environ.get("PORT", "8765"))


def load_email_config():
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, dict):
                return data

    return {
        "smtp_host": os.environ.get("SMTP_HOST", ""),
        "smtp_port": int(os.environ.get("SMTP_PORT", "587")),
        "smtp_user": os.environ.get("SMTP_USER", ""),
        "smtp_pass": os.environ.get("SMTP_PASS", ""),
        "from_email": os.environ.get("SMTP_FROM", ""),
        "from_name": os.environ.get("SMTP_FROM_NAME", "SecureBank"),
    }


def send_smtp_email(to_addr, subject, body):
    cfg = load_email_config()
    host = cfg.get("smtp_host") or cfg.get("smtpHost") or ""
    port = int(cfg.get("smtp_port") or cfg.get("smtpPort") or 587)
    user = cfg.get("smtp_user") or cfg.get("smtpUser") or ""
    password = cfg.get("smtp_pass") or cfg.get("smtpPass") or ""
    from_email = cfg.get("from_email") or cfg.get("fromEmail") or user
    from_name = cfg.get("from_name") or cfg.get("fromName") or "SecureBank"

    if not host or not user or not password:
        return {
            "ok": False,
            "error": "Email not configured. Copy email.config.example.json to email.config.json and add SMTP credentials.",
        }

    message = MIMEText(body, "plain", "utf-8")
    message["Subject"] = subject
    message["From"] = f"{from_name} <{from_email}>"
    message["To"] = to_addr

    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(user, password)
        server.sendmail(from_email, [to_addr], message.as_string())

    return {"ok": True}


class SecureBankHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_OPTIONS(self):
        if self.path == "/api/send-email":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/api/send-email":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            to_addr = str(payload.get("to", "")).strip()
            subject = str(payload.get("subject", "")).strip()
            body = str(payload.get("body", "")).strip()

            if not to_addr or not subject or not body:
                self._json(400, {"ok": False, "error": "Missing to, subject, or body."})
                return

            result = send_smtp_email(to_addr, subject, body)
            self._json(200 if result.get("ok") else 503, result)
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "Invalid JSON body."})
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})

    def _json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), SecureBankHandler)
    print("")
    print(f"SecureBank running at http://localhost:{PORT}")
    print(f"  User:  http://localhost:{PORT}/index.html")
    print(f"  Admin: http://localhost:{PORT}/admin.html")
    if not CONFIG_PATH.exists():
        print("")
        print("  Email: not configured (copy email.config.example.json -> email.config.json)")
    print("")
    print("Press Ctrl+C to stop.")
    print("")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
