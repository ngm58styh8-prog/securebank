#!/usr/bin/env python3
"""GlobalVest static server with deposit email notifications."""

import json
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "email.config.json"
ACCOUNTS_REGISTRY_PATH = ROOT / "data" / "accounts.json"
ADMIN_REGISTRY_PATH = ROOT / "data" / "admin.json"
PORT = int(os.environ.get("PORT", "8765"))


def normalize_registry_email(email):
    return str(email or "").strip().lower()


def ensure_accounts_registry_dir():
    ACCOUNTS_REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_accounts_registry():
    ensure_accounts_registry_dir()
    if not ACCOUNTS_REGISTRY_PATH.exists():
        return {}

    try:
        with open(ACCOUNTS_REGISTRY_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}

    if not isinstance(data, dict):
        return {}

    normalized = {}
    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        email_key = normalize_registry_email(key)
        if not email_key or "@" not in email_key:
            continue
        if email_key in normalized:
            normalized[email_key] = {**normalized[email_key], **entry}
        else:
            normalized[email_key] = entry
    return normalized


def save_accounts_registry(accounts):
    ensure_accounts_registry_dir()
    with open(ACCOUNTS_REGISTRY_PATH, "w", encoding="utf-8") as handle:
        json.dump(accounts, handle, indent=2)


def load_admin_registry():
    ensure_accounts_registry_dir()
    if not ADMIN_REGISTRY_PATH.exists():
        return None
    try:
        with open(ADMIN_REGISTRY_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError):
        return None


def save_admin_registry(admin):
    ensure_accounts_registry_dir()
    with open(ADMIN_REGISTRY_PATH, "w", encoding="utf-8") as handle:
        json.dump(admin, handle, indent=2)


DEFAULT_ADMIN_REGISTRY = {
    "email": "admin@globalvest.com",
    "password": "admin123",
    "balance": 0,
    "payments": [],
    "pendingTransfers": [],
    "pendingDeposits": [],
    "walletAddress": "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
    "bankDetails": "GlobalVest Admin · Routing: 021000021 · Account: 8847291053",
    "registeredUsers": {},
    "userActivityLog": [],
    "notificationLog": [],
}


def ensure_admin_registry():
    existing = load_admin_registry()
    admin = {**DEFAULT_ADMIN_REGISTRY, **(existing or {})}
    if not isinstance(admin.get("registeredUsers"), dict):
        admin["registeredUsers"] = {}
    if not isinstance(admin.get("userActivityLog"), list):
        admin["userActivityLog"] = []
    return admin


def link_account_to_admin_registry(email, account, event_type="signup"):
    admin = ensure_admin_registry()
    key = normalize_registry_email(email)
    profile = account.get("profile") or {}
    user_name = profile.get("fullName") or key
    now = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    existing = admin["registeredUsers"].get(key)
    is_new = not existing

    admin["registeredUsers"][key] = {
        "email": key,
        "name": user_name,
        "phone": profile.get("phone") or "",
        "memberSince": profile.get("memberSince"),
        "lastLoginAt": profile.get("lastLoginAt"),
        "lastLoginDevice": profile.get("lastLoginDevice"),
        "emailVerified": bool(account.get("emailVerified")),
        "verificationStatus": profile.get("verificationStatus") or "Pending",
        "withdrawalsFrozen": bool(account.get("withdrawalsFrozen")),
        "linkedAt": existing.get("linkedAt") if existing else now,
        "updatedAt": now,
    }

    if event_type != "admin-adjust" and (event_type == "signup" or is_new):
        has_signup = any(
            entry.get("type") == "signup" and normalize_registry_email(entry.get("userEmail", "")) == key
            for entry in admin["userActivityLog"]
        )
        if not has_signup:
            admin["userActivityLog"].insert(0, {
                "id": __import__("time").time(),
                "date": __import__("datetime").datetime.utcnow().strftime("%m/%d/%Y, %I:%M:%S %p"),
                "userEmail": key,
                "userName": user_name,
                "type": "signup",
                "description": "New account registered" if is_new else "Account linked to admin dashboard",
                "amount": 0,
            })

    if event_type == "login":
        admin["userActivityLog"].insert(0, {
            "id": __import__("time").time(),
            "date": __import__("datetime").datetime.utcnow().strftime("%m/%d/%Y, %I:%M:%S %p"),
            "userEmail": key,
            "userName": user_name,
            "type": "login",
            "description": "Signed in from " + (profile.get("lastLoginDevice") or "web"),
            "amount": 0,
        })

    admin["userActivityLog"] = admin["userActivityLog"][:500]
    save_admin_registry(admin)
    return {"linked": True, "email": key}


def send_api_json(handler, status, payload):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


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
        "from_name": os.environ.get("SMTP_FROM_NAME", "GlobalVest"),
    }


def send_smtp_email(to_addr, subject, body):
    cfg = load_email_config()
    host = cfg.get("smtp_host") or cfg.get("smtpHost") or ""
    port = int(cfg.get("smtp_port") or cfg.get("smtpPort") or 587)
    user = cfg.get("smtp_user") or cfg.get("smtpUser") or ""
    password = cfg.get("smtp_pass") or cfg.get("smtpPass") or ""
    from_email = cfg.get("from_email") or cfg.get("fromEmail") or user
    from_name = cfg.get("from_name") or cfg.get("fromName") or "GlobalVest"

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


class GlobalVestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_OPTIONS(self):
        if self.path in ("/api/send-email", "/api/accounts", "/api/admin-data"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        if self.path == "/api/accounts":
            accounts = load_accounts_registry()
            send_api_json(self, 200, {"ok": True, "accounts": accounts, "count": len(accounts)})
            return
        if self.path == "/api/admin-data":
            admin = load_admin_registry()
            send_api_json(self, 200, {"ok": True, "admin": admin})
            return
        super().do_GET()

    def do_PUT(self):
        if self.path == "/api/accounts":
            self._handle_accounts_write()
            return
        if self.path == "/api/admin-data":
            self._handle_admin_write()
            return
        self.send_error(404)

    def do_POST(self):
        if self.path == "/api/accounts":
            self._handle_accounts_write()
            return
        if self.path == "/api/admin-data":
            self._handle_admin_write()
            return
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

    def do_DELETE(self):
        if self.path == "/api/accounts":
            self._handle_accounts_delete()
            return
        self.send_error(404)

    def _handle_accounts_write(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            email = normalize_registry_email(payload.get("email", ""))
            account = payload.get("account")

            if not email or "@" not in email or not isinstance(account, dict):
                send_api_json(self, 400, {"ok": False, "error": "Missing or invalid email/account payload."})
                return

            accounts = load_accounts_registry()
            if email in accounts and isinstance(accounts[email], dict):
                account = {**accounts[email], **account}
            account["serverSyncedAt"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
            accounts[email] = account
            save_accounts_registry(accounts)
            event_type = payload.get("eventType") or "signup"
            link_account_to_admin_registry(email, account, event_type)
            send_api_json(self, 200, {
                "ok": True,
                "email": email,
                "adminLinked": True,
                "count": len(accounts)
            })
        except json.JSONDecodeError:
            send_api_json(self, 400, {"ok": False, "error": "Invalid JSON body."})
        except Exception as exc:
            send_api_json(self, 500, {"ok": False, "error": str(exc)})

    def _handle_accounts_delete(self):
        try:
            from urllib.parse import urlparse, parse_qs

            length = int(self.headers.get("Content-Length", 0))
            payload = {}
            if length > 0:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))

            query = parse_qs(urlparse(self.path).query)
            email = normalize_registry_email(
                payload.get("email", "") or (query.get("email", [""])[0] if query.get("email") else "")
            )

            if not email or "@" not in email:
                send_api_json(self, 400, {"ok": False, "error": "Missing or invalid email."})
                return

            accounts = load_accounts_registry()
            accounts.pop(email, None)
            save_accounts_registry(accounts)
            admin = ensure_admin_registry()
            admin.get("registeredUsers", {}).pop(email, None)
            save_admin_registry(admin)
            send_api_json(self, 200, {"ok": True, "email": email, "deleted": True, "count": len(accounts)})
        except json.JSONDecodeError:
            send_api_json(self, 400, {"ok": False, "error": "Invalid JSON body."})
        except Exception as exc:
            send_api_json(self, 500, {"ok": False, "error": str(exc)})

    def _handle_admin_write(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            admin = payload.get("admin")

            if not isinstance(admin, dict) or not admin.get("email"):
                send_api_json(self, 400, {"ok": False, "error": "Missing or invalid admin payload."})
                return

            existing = load_admin_registry()
            if isinstance(existing, dict):
                admin = {**existing, **admin}
            admin["serverSyncedAt"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
            save_admin_registry(admin)
            send_api_json(self, 200, {"ok": True, "email": admin["email"]})
        except json.JSONDecodeError:
            send_api_json(self, 400, {"ok": False, "error": "Invalid JSON body."})
        except Exception as exc:
            send_api_json(self, 500, {"ok": False, "error": str(exc)})

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
    server = ThreadingHTTPServer(("0.0.0.0", PORT), GlobalVestHandler)
    print("")
    print(f"GlobalVest running at http://localhost:{PORT}")
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
