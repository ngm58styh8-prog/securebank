/**
 * Resolve Supabase admin credentials from legacy or new API key env vars.
 *
 * Accepted admin key sources (first match wins):
 *   SUPABASE_SECRET_KEY          — single sb_secret_... key (Vercel / CLI)
 *   SUPABASE_SECRET_KEYS         — JSON map, e.g. {"default":"sb_secret_..."}
 *   SUPABASE_SERVICE_ROLE_KEY    — legacy JWT service_role key (or JSON map)
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

    const direct = cleanEnvValue(raw);
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

function validateAdminKey(key) {
    const cleaned = cleanEnvValue(key);
    if (!cleaned) {
        throw new Error("Supabase admin key is empty.");
    }
    return cleaned;
}

function getAdminKeyWarning(key) {
    const cleaned = cleanEnvValue(key);
    if (isSupabasePublishableKey(cleaned)) {
        return "Using publishable key for server RPC. Prefer SUPABASE_SECRET_KEY or a service_role JWT.";
    }
    if (isSupabaseJwtKey(cleaned) && getJwtRole(cleaned) === "anon") {
        return "Using anon JWT for server RPC. Prefer SUPABASE_SECRET_KEY or a service_role JWT.";
    }
    return null;
}

function getSupabaseAdminKey() {
    const candidates = [
        resolveKeyFromEnv("SUPABASE_SECRET_KEY"),
        resolveKeyFromEnv("SUPABASE_SECRET_KEYS"),
        resolveKeyFromEnv("SUPABASE_SERVICE_ROLE_KEY")
    ];

    for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].key) {
            return candidates[i];
        }
    }

    return { key: "", source: null };
}

function getValidatedSupabaseAdminKey() {
    const admin = getSupabaseAdminKey();
    if (!admin.key) {
        return admin;
    }
    return {
        key: validateAdminKey(admin.key),
        source: admin.source
    };
}

function getSupabaseEnvChecks() {
    const url = getSupabaseUrl();
    const admin = getSupabaseAdminKey();

    return {
        SUPABASE_URL: { set: !!url },
        SUPABASE_ADMIN_KEY: {
            set: !!admin.key,
            source: admin.source,
            type: admin.key
                ? (isSupabaseSecretKey(admin.key)
                    ? "secret"
                    : (isSupabasePublishableKey(admin.key)
                        ? "publishable"
                        : (isSupabaseJwtKey(admin.key) ? "service_role" : "unknown")))
                : null,
            warning: admin.key ? getAdminKeyWarning(admin.key) : null
        },
        SUPABASE_SECRET_KEY: { set: !!resolveKeyFromEnv("SUPABASE_SECRET_KEY").key },
        SUPABASE_SECRET_KEYS: { set: !!resolveKeyFromEnv("SUPABASE_SECRET_KEYS").key },
        SUPABASE_SERVICE_ROLE_KEY: { set: !!resolveKeyFromEnv("SUPABASE_SERVICE_ROLE_KEY").key }
    };
}

function getMissingSupabaseEnv() {
    const missing = [];
    if (!getSupabaseUrl()) missing.push("SUPABASE_URL");

    const admin = getSupabaseAdminKey();
    if (!admin.key) {
        missing.push("SUPABASE_ADMIN_KEY (set SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY)");
    }

    return missing;
}

function buildSupabaseHeaders(key) {
    const cleaned = validateAdminKey(key);
    const headers = {
        apikey: cleaned,
        "Content-Type": "application/json"
    };

    // RLS bypass is determined by Authorization, not apikey (legacy JWT service_role).
    // sb_secret_* keys must stay on apikey only.
    if (isSupabaseJwtKey(cleaned)) {
        headers.Authorization = "Bearer " + cleaned;
    }

    return headers;
}

module.exports = {
    cleanEnvValue,
    getSupabaseUrl,
    getSupabaseAdminKey,
    getValidatedSupabaseAdminKey,
    isSupabaseJwtKey,
    isSupabaseSecretKey,
    isSupabasePublishableKey,
    getJwtRole,
    getAdminKeyWarning,
    getSupabaseEnvChecks,
    getMissingSupabaseEnv,
    buildSupabaseHeaders
};
