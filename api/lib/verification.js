const crypto = require("crypto");
const { supabaseRpc } = require("./supabase-admin-rest");
const { ensureVerificationSchema } = require("./verification-schema");
const { sendVerificationEmail } = require("./resend");

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateVerificationCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function firstRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
}

async function getLatestVerification(email) {
    const data = await supabaseRpc("globalvest_get_latest_verification", {
        p_email: email
    });
    return firstRow(data);
}

async function getUnverifiedVerification(email) {
    const data = await supabaseRpc("globalvest_get_unverified", {
        p_email: email
    });
    return firstRow(data);
}

async function createAndSendVerification(email, options) {
    options = options || {};
    const normalized = normalizeEmail(email);

    if (!isValidEmail(normalized)) {
        return { ok: false, status: 400, error: "Please enter a valid email address." };
    }

    await ensureVerificationSchema();

    if (options.enforceCooldown) {
        const latest = await getLatestVerification(normalized);
        if (latest && latest.created_at) {
            const elapsed = Date.now() - new Date(latest.created_at).getTime();
            if (elapsed < RESEND_COOLDOWN_MS) {
                const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
                return {
                    ok: false,
                    status: 429,
                    error: "Please wait " + retryAfter + " seconds before requesting another code.",
                    retryAfter: retryAfter
                };
            }
        }
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    await supabaseRpc("globalvest_delete_unverified", { p_email: normalized });
    await supabaseRpc("globalvest_insert_verification", {
        p_email: normalized,
        p_code: code,
        p_expires_at: expiresAt
    });

    await sendVerificationEmail(normalized, code);

    return {
        ok: true,
        status: 200,
        email: normalized,
        expiresInSeconds: CODE_TTL_MS / 1000
    };
}

async function verifyEmailCode(email, code) {
    const normalized = normalizeEmail(email);
    const submitted = String(code || "").trim();

    if (!isValidEmail(normalized)) {
        return { ok: false, status: 400, error: "Please enter a valid email address." };
    }

    if (!/^\d{6}$/.test(submitted)) {
        return { ok: false, status: 400, error: "Enter a valid 6-digit verification code." };
    }

    await ensureVerificationSchema();

    const data = await getUnverifiedVerification(normalized);

    if (!data) {
        return { ok: false, status: 400, error: "No active verification code found. Request a new code." };
    }

    if (new Date(data.expires_at).getTime() < Date.now()) {
        return { ok: false, status: 400, error: "Verification code has expired. Request a new code." };
    }

    if (data.code !== submitted) {
        return { ok: false, status: 400, error: "Invalid verification code." };
    }

    await supabaseRpc("globalvest_mark_verified", { p_id: data.id });
    await markServerAccountEmailVerified(normalized);

    return { ok: true, status: 200, email: normalized };
}

async function markServerAccountEmailVerified(email) {
    try {
        const fs = require("fs");
        const path = require("path");
        const registryPath = path.join(process.cwd(), "data", "accounts.json");
        if (!fs.existsSync(registryPath)) return;

        const accounts = JSON.parse(fs.readFileSync(registryPath, "utf8"));
        if (!accounts[email] || typeof accounts[email] !== "object") return;

        accounts[email].emailVerified = true;
        accounts[email].emailVerificationCode = null;
        fs.writeFileSync(registryPath, JSON.stringify(accounts, null, 2));
    } catch (e) {
        /* optional — client also syncs via saveAccount */
    }
}

module.exports = {
    normalizeEmail,
    createAndSendVerification,
    verifyEmailCode
};
