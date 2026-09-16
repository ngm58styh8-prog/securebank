const crypto = require("crypto");
const { loadAllAccounts, upsertAccount } = require("./registry");
const { sendTransactionalEmail } = require("./resend");
const { buildTransactionalEmailContent } = require("./email-deliverability");

const CODE_TTL_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const GENERIC_MESSAGE = "If an account exists for that email, we sent a 6-digit reset code.";

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateResetCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function isValidNewPassword(password) {
    return typeof password === "string" && password.length >= 6 && password.length <= 128;
}

function pushPasswordNotification(account, message) {
    if (!Array.isArray(account.notifications)) account.notifications = [];
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: message,
        title: "Password updated",
        time: new Date().toISOString(),
        read: false,
        type: "security",
        category: "security"
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }
}

function clearResetFields(account) {
    account.passwordResetCode = null;
    account.passwordResetExpiresAt = null;
    account.passwordResetSentAt = null;
    account.passwordResetAttempts = 0;
}

async function sendPasswordResetEmail(account, email, code) {
    const name = (account.profile && account.profile.fullName) || email;
    const body =
        "Hi " + name + ",\n\n" +
        "We received a request to reset your GlobalVest password. Enter this 6-digit code on the sign-in page:\n\n" +
        code + "\n\n" +
        "This code expires in 15 minutes. If you did not request a reset, you can ignore this email — your password will stay the same.\n\n" +
        "GlobalVest Security Team";

    const content = buildTransactionalEmailContent(
        "Reset your GlobalVest password",
        body,
        email,
        {
            category: "password-reset",
            headline: "Password reset code",
            referenceId: "gv-password-reset-" + Date.now()
        }
    );

    await sendTransactionalEmail({
        to: email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: content.headers,
        tags: content.tags
    });
}

async function requestPasswordReset(email) {
    const key = normalizeEmail(email);
    if (!isValidEmail(key)) {
        return { ok: false, status: 400, error: "Please enter a valid email address." };
    }

    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) {
        return {
            ok: true,
            status: 200,
            message: GENERIC_MESSAGE,
            emailSent: true
        };
    }

    const lastSent = account.passwordResetSentAt ? Date.parse(account.passwordResetSentAt) : 0;
    if (lastSent && Date.now() - lastSent < COOLDOWN_MS) {
        return {
            ok: true,
            status: 200,
            message: GENERIC_MESSAGE,
            emailSent: true,
            throttled: true
        };
    }

    const code = generateResetCode();
    account.passwordResetCode = code;
    account.passwordResetExpiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    account.passwordResetSentAt = new Date().toISOString();
    account.passwordResetAttempts = 0;

    await upsertAccount(key, account, {
        eventType: "password-reset-request",
        source: "requestPasswordReset"
    });

    let emailSent = false;
    let emailError = null;
    try {
        await sendPasswordResetEmail(account, key, code);
        emailSent = true;
    } catch (err) {
        emailError = err && err.message ? err.message : String(err);
        console.warn("[password-reset] email failed", { email: key, error: emailError });
    }

    return {
        ok: true,
        status: 200,
        message: GENERIC_MESSAGE,
        emailSent: emailSent,
        emailError: emailError
    };
}

async function completePasswordReset(email, code, newPassword) {
    const key = normalizeEmail(email);
    const submitted = String(code || "").trim();

    if (!isValidEmail(key)) {
        return { ok: false, status: 400, error: "Please enter a valid email address." };
    }
    if (!/^\d{6}$/.test(submitted)) {
        return { ok: false, status: 400, error: "Enter the 6-digit code from your email." };
    }
    if (!isValidNewPassword(newPassword)) {
        return { ok: false, status: 400, error: "Password must be 6–128 characters." };
    }

    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account || !account.passwordResetCode) {
        return { ok: false, status: 400, error: "No active reset code. Request a new code." };
    }

    const attempts = Number(account.passwordResetAttempts || 0);
    if (attempts >= MAX_ATTEMPTS) {
        clearResetFields(account);
        await upsertAccount(key, account, {
            eventType: "password-reset-lock",
            source: "completePasswordReset"
        });
        return { ok: false, status: 400, error: "Too many attempts. Request a new reset code." };
    }

    const expiresAt = Date.parse(account.passwordResetExpiresAt || "");
    if (!expiresAt || expiresAt < Date.now()) {
        clearResetFields(account);
        await upsertAccount(key, account, {
            eventType: "password-reset-expired",
            source: "completePasswordReset"
        });
        return { ok: false, status: 400, error: "That code has expired. Request a new one." };
    }

    if (String(account.passwordResetCode) !== submitted) {
        account.passwordResetAttempts = attempts + 1;
        await upsertAccount(key, account, {
            eventType: "password-reset-mismatch",
            source: "completePasswordReset"
        });
        return { ok: false, status: 400, error: "Invalid reset code." };
    }

    account.password = newPassword;
    account.passwordUpdatedAt = new Date().toISOString();
    clearResetFields(account);
    pushPasswordNotification(account, "Your password was reset successfully.");

    await upsertAccount(key, account, {
        eventType: "password-reset",
        source: "completePasswordReset"
    });

    return { ok: true, status: 200, email: key };
}

module.exports = {
    CODE_TTL_MS,
    GENERIC_MESSAGE,
    normalizeEmail,
    isValidNewPassword,
    requestPasswordReset,
    completePasswordReset
};
