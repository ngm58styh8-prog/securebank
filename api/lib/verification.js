const crypto = require("crypto");
const { supabaseRest } = require("./supabase-admin-rest");
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

async function withRlsRetry(action) {
    try {
        return await action();
    } catch (err) {
        if (!String(err.message || "").includes("row-level security")) {
            throw err;
        }

        const schema = require("./verification-schema");
        if (typeof schema.resetVerificationSchemaCache === "function") {
            schema.resetVerificationSchemaCache();
        }
        await ensureVerificationSchema();
        return action();
    }
}

async function deleteUnverified(email) {
    return withRlsRetry(function() {
        return supabaseRest(
            "DELETE",
            "email_verifications?email=eq." + encodeURIComponent(email) + "&verified=eq.false"
        );
    });
}

async function insertVerification(email, code, expiresAt) {
    return withRlsRetry(function() {
        return supabaseRest("POST", "email_verifications", {
            body: {
                email: email,
                code: code,
                expires_at: expiresAt,
                verified: false
            },
            prefer: "return=minimal"
        });
    });
}

async function getLatestVerification(email) {
    const data = await supabaseRest(
        "GET",
        "email_verifications?email=eq." + encodeURIComponent(email) + "&order=created_at.desc&limit=1",
        { prefer: "return=representation" }
    );
    return firstRow(data);
}

async function getUnverifiedVerification(email) {
    const data = await supabaseRest(
        "GET",
        "email_verifications?email=eq." + encodeURIComponent(email) +
            "&verified=eq.false&order=created_at.desc&limit=1",
        { prefer: "return=representation" }
    );
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

    await deleteUnverified(normalized);
    await insertVerification(normalized, code, expiresAt);

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

    await supabaseRest(
        "PATCH",
        "email_verifications?id=eq." + encodeURIComponent(data.id),
        {
            body: { verified: true },
            prefer: "return=minimal"
        }
    );

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
