/**
 * Resolve Supabase admin credentials from legacy or new API key env vars.
 *
 * Accepted admin key sources (first match wins):
 *   SUPABASE_SECRET_KEY          — single sb_secret_... key (Vercel / CLI)
 *   SUPABASE_SECRET_KEYS         — JSON map, e.g. {"default":"sb_secret_..."}
 *   SUPABASE_SERVICE_ROLE_KEY    — legacy JWT service_role key
 */

function parseSecretKeysJson(raw) {
    if (!raw || !String(raw).trim()) return null;
    try {
        const parsed = JSON.parse(raw);
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
        const value = String(values[i] || "").trim();
        if (value) return value;
    }
    return "";
}

function getSupabaseUrl() {
    return String(process.env.SUPABASE_URL || "").trim();
}

function getSupabaseAdminKey() {
    const directSecret = String(process.env.SUPABASE_SECRET_KEY || "").trim();
    if (directSecret) {
        return { key: directSecret, source: "SUPABASE_SECRET_KEY" };
    }

    const secretKeys = parseSecretKeysJson(process.env.SUPABASE_SECRET_KEYS);
    if (secretKeys) {
        const named = firstNonEmpty([
            secretKeys.default,
            secretKeys["default"],
            Object.values(secretKeys)[0]
        ]);
        if (named) {
            return { key: named, source: "SUPABASE_SECRET_KEYS" };
        }
    }

    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (serviceRole) {
        return { key: serviceRole, source: "SUPABASE_SERVICE_ROLE_KEY" };
    }

    return { key: "", source: null };
}

function isSupabaseJwtKey(key) {
    const parts = String(key || "").split(".");
    return parts.length === 3 && parts.every(function(part) { return part.length > 0; });
}

function isSupabaseSecretKey(key) {
    return String(key || "").startsWith("sb_secret_");
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
                ? (isSupabaseSecretKey(admin.key) ? "secret" : (isSupabaseJwtKey(admin.key) ? "service_role" : "unknown"))
                : null
        },
        SUPABASE_SECRET_KEY: { set: !!String(process.env.SUPABASE_SECRET_KEY || "").trim() },
        SUPABASE_SECRET_KEYS: { set: !!parseSecretKeysJson(process.env.SUPABASE_SECRET_KEYS) },
        SUPABASE_SERVICE_ROLE_KEY: { set: !!String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() }
    };
}

function getMissingSupabaseEnv() {
    const missing = [];
    if (!getSupabaseUrl()) missing.push("SUPABASE_URL");

    if (!getSupabaseAdminKey().key) {
        missing.push("SUPABASE_ADMIN_KEY (set SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY)");
    }

    return missing;
}

module.exports = {
    getSupabaseUrl,
    getSupabaseAdminKey,
    isSupabaseJwtKey,
    isSupabaseSecretKey,
    getSupabaseEnvChecks,
    getMissingSupabaseEnv
};
