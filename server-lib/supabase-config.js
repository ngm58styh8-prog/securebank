/**
 * Server-only Supabase admin credentials for email_verifications.
 *
 * Priority:
 *   1. SUPABASE_SERVICE_ROLE_KEY  — service_role JWT (eyJ...) or legacy key
 *   2. SUPABASE_SECRET_KEY        — sb_secret_... key
 *   3. SUPABASE_SECRET_KEYS       — JSON map of secret keys
 */

function cleanEnvValue(value) {
    let val = String(value || "").trim();
    if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
    ) {
        val = val.slice(1, -1).trim();
    }
    return val;
}

function parseSecretKeysJson(raw) {
    const cleaned = cleanEnvValue(raw);
    if (!cleaned || !cleaned.startsWith("{")) return null;
    try {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        /* ignore */
    }
    return null;
}

function firstNonEmpty(values) {
    for (let i = 0; i < values.length; i++) {
        const value = cleanEnvValue(values[i]);
        if (value) return value;
    }
    return "";
}

function resolveKeyFromEnv(name) {
    const raw = process.env[name];
    if (!raw) return { key: "", source: null };

    const parsed = parseSecretKeysJson(raw);
    if (parsed) {
        const named = firstNonEmpty([
            parsed.default,
            parsed["default"],
            Object.values(parsed)[0]
        ]);
        if (named) {
            return { key: named, source: name };
        }
    }

    const direct = cleanEnvValue(raw);
    if (direct) {
        return { key: direct, source: name };
    }

    return { key: "", source: null };
}

function getSupabaseUrl() {
    return cleanEnvValue(process.env.SUPABASE_URL);
}

function isSupabaseJwtKey(key) {
    return cleanEnvValue(key).startsWith("eyJ");
}

function isSupabaseSecretKey(key) {
    return cleanEnvValue(key).startsWith("sb_secret_");
}

function isSupabasePublishableKey(key) {
    return cleanEnvValue(key).startsWith("sb_publishable_");
}

function getJwtRole(key) {
    if (!isSupabaseJwtKey(key)) return null;
    try {
        const payloadPart = cleanEnvValue(key).split(".")[1];
        if (!payloadPart) return null;
        const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        return payload.role || null;
    } catch (e) {
        return null;
    }
}

function validateServiceRoleKey(key, sourceLabel) {
    const cleaned = cleanEnvValue(key);
    const label = sourceLabel || "SUPABASE_SERVICE_ROLE_KEY";

    if (!cleaned) {
        throw new Error(label + " is empty.");
    }
    if (isSupabasePublishableKey(cleaned)) {
        throw new Error(
            label + " is a publishable key (sb_publishable_...). Use the service_role JWT or sb_secret_ key from Supabase → Settings → API Keys."
        );
    }
    if (isSupabaseSecretKey(cleaned)) {
        return cleaned;
    }
    if (isSupabaseJwtKey(cleaned)) {
        const role = getJwtRole(cleaned);
        if (role !== "service_role") {
            throw new Error(
                label + " JWT must have role service_role (found " + (role || "unknown") + ")."
            );
        }
        return cleaned;
    }

    throw new Error(
        label + " must be a service_role JWT (eyJ...) or sb_secret_ key."
    );
}

function getSupabaseServiceRoleKey() {
    const candidates = [
        resolveKeyFromEnv("SUPABASE_SERVICE_ROLE_KEY"),
        resolveKeyFromEnv("SUPABASE_SECRET_KEY"),
        resolveKeyFromEnv("SUPABASE_SECRET_KEYS")
    ];

    for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].key) {
            return candidates[i];
        }
    }

    return { key: "", source: null };
}

function getValidatedServiceRoleKey() {
    const resolved = getSupabaseServiceRoleKey();
    if (!resolved.key) {
        return resolved;
    }
    return {
        key: validateServiceRoleKey(resolved.key, resolved.source),
        source: resolved.source
    };
}

function getServiceRoleKeyType(key) {
    if (!key) return null;
    if (isSupabaseSecretKey(key)) return "secret";
    if (isSupabasePublishableKey(key)) return "publishable";
    if (isSupabaseJwtKey(key)) return getJwtRole(key) === "service_role" ? "service_role" : "jwt_" + (getJwtRole(key) || "unknown");
    return "unknown";
}

function getSupabaseEnvChecks() {
    const url = getSupabaseUrl();
    const raw = resolveKeyFromEnv("SUPABASE_SERVICE_ROLE_KEY");
    let serviceRoleValid = false;
    let serviceRoleError = null;

    if (raw.key) {
        try {
            validateServiceRoleKey(raw.key, "SUPABASE_SERVICE_ROLE_KEY");
            serviceRoleValid = true;
        } catch (e) {
            serviceRoleError = e.message;
        }
    }

    return {
        SUPABASE_URL: { set: !!url },
        SUPABASE_SERVICE_ROLE_KEY: {
            set: !!raw.key,
            valid: serviceRoleValid,
            type: raw.key ? getServiceRoleKeyType(raw.key) : null,
            error: serviceRoleError
        },
        RESEND_API_KEY: { set: !!cleanEnvValue(process.env.RESEND_API_KEY) },
        RESEND_FROM_EMAIL: { set: !!cleanEnvValue(process.env.RESEND_FROM_EMAIL) }
    };
}

function getMissingSupabaseEnv() {
    const missing = [];
    if (!getSupabaseUrl()) missing.push("SUPABASE_URL");

    const raw = resolveKeyFromEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!raw.key) {
        missing.push("SUPABASE_SERVICE_ROLE_KEY");
    } else {
        try {
            validateServiceRoleKey(raw.key, "SUPABASE_SERVICE_ROLE_KEY");
        } catch (e) {
            missing.push(e.message);
        }
    }

    if (!cleanEnvValue(process.env.RESEND_API_KEY)) missing.push("RESEND_API_KEY");
    if (!cleanEnvValue(process.env.RESEND_FROM_EMAIL)) missing.push("RESEND_FROM_EMAIL");

    return missing;
}

function buildServiceRoleHeaders(key) {
    const cleaned = validateServiceRoleKey(key);
    const headers = {
        apikey: cleaned,
        "Content-Type": "application/json"
    };

    if (isSupabaseJwtKey(cleaned)) {
        headers.Authorization = "Bearer " + cleaned;
    }

    return headers;
}

module.exports = {
    cleanEnvValue,
    getSupabaseUrl,
    getSupabaseServiceRoleKey,
    getValidatedServiceRoleKey,
    validateServiceRoleKey,
    isSupabaseJwtKey,
    isSupabaseSecretKey,
    isSupabasePublishableKey,
    getJwtRole,
    getServiceRoleKeyType,
    getSupabaseEnvChecks,
    getMissingSupabaseEnv,
    buildServiceRoleHeaders,
    getSupabaseAdminKey: getSupabaseServiceRoleKey,
    getValidatedSupabaseAdminKey: getValidatedServiceRoleKey,
    buildSupabaseHeaders: buildServiceRoleHeaders
};
