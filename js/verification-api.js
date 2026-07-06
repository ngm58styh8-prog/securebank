(function() {
    function apiBase() {
        if (typeof window === "undefined") return "";
        if (window.location.protocol === "http:" || window.location.protocol === "https:") {
            return "";
        }
        return "";
    }

    async function postJson(path, payload) {
        let response;
        try {
            response = await fetch(apiBase() + path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            return {
                ok: false,
                error: "Verification service unavailable. Deploy with Vercel or run: npx vercel dev"
            };
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return {
                ok: false,
                error: "Verification API not found. Use Vercel deployment or npx vercel dev (not ./start.sh alone)."
            };
        }

        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = { ok: false, error: "Invalid server response." };
        }

        if (!response.ok) {
            data.ok = false;
            data.error = data.error || "Request failed.";
            if (data.retryAfter) data.retryAfter = data.retryAfter;
        }

        return data;
    }

    function markEmailVerifiedLocally(email) {
        const key = normalizeEmail(email);
        const account = getAccount(key);
        if (!account) return { ok: false, error: "Account not found." };

        account.emailVerified = true;
        account.emailVerificationCode = null;
        account.notifications.unshift({
            id: Date.now(),
            message: "Email verified — your account is now active",
            time: new Date().toISOString(),
            read: false
        });
        if (account.notifications.length > 30) {
            account.notifications = account.notifications.slice(0, 30);
        }
        saveAccount(key, account);
        return { ok: true };
    }

    async function requestVerificationEmail(email) {
        return postJson("/api/send-verification", { email: normalizeEmail(email) });
    }

    async function resendVerificationEmail(email) {
        return postJson("/api/resend-verification", { email: normalizeEmail(email) });
    }

    function verifyEmailCodeLocal(email, code) {
        const key = normalizeEmail(email);
        const account = getAccount(key);
        if (!account) return { ok: false, error: "Account not found." };
        if (account.emailVerified) return { ok: true };

        const expected = String(account.emailVerificationCode || "").trim();
        if (!expected || String(code || "").trim() !== expected) {
            return { ok: false, error: "Invalid verification code." };
        }

        return markEmailVerifiedLocally(key);
    }

    async function verifyEmailWithBackend(email, code) {
        const key = normalizeEmail(email);
        const account = getAccount(key);

        if (!account) {
            return { ok: false, error: "Account not found." };
        }

        if (account.emailVerified) {
            return { ok: true };
        }

        try {
            const result = await postJson("/api/verify-email", {
                email: key,
                code: String(code || "").trim()
            });

            if (result.ok) {
                markEmailVerifiedLocally(key);
                return { ok: true };
            }

            return result;
        } catch (err) {
            return {
                ok: false,
                error: "Verification service unavailable. Check your connection and try again."
            };
        }
    }

    window.requestVerificationEmail = requestVerificationEmail;
    window.resendVerificationEmail = resendVerificationEmail;
    window.verifyEmailWithBackend = verifyEmailWithBackend;
    window.markEmailVerifiedLocally = markEmailVerifiedLocally;
})();
