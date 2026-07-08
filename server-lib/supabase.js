const { createClient } = require("@supabase/supabase-js");
const {
    getSupabaseUrl,
    getValidatedServiceRoleKey,
    isSupabaseJwtKey,
    validateServiceRoleKey
} = require("./supabase-config");

const SUPABASE_FETCH_TIMEOUT_MS = 12000;

function normalizeSupabaseErrorMessage(err) {
    const message = err && err.message ? String(err.message) : String(err || "Unknown Supabase error");
    if (message.indexOf("<!DOCTYPE") !== -1 || message.indexOf("<html") !== -1) {
        return "Supabase returned an HTML error page instead of JSON. " +
            "Check SUPABASE_URL in Vercel (must be https://YOUR-PROJECT.supabase.co), " +
            "confirm the project is not paused in Supabase Dashboard, and run " +
            "supabase/migrations/002_app_registry.sql.";
    }
    if (message.indexOf("aborted") !== -1 || message.indexOf("timed out") !== -1) {
        return "Supabase request timed out. The project may be paused, the URL may be wrong, " +
            "or the registry tables may be missing. Run supabase/migrations/002_app_registry.sql.";
    }
    return message;
}

function createTimeoutFetch(timeoutMs) {
    return async function timeoutFetch(input, init) {
        const controller = new AbortController();
        const timer = setTimeout(function() {
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(input, Object.assign({}, init || {}, {
                signal: controller.signal
            }));
            const contentType = String(response.headers.get("content-type") || "").toLowerCase();

            if (!response.ok && contentType.indexOf("text/html") !== -1) {
                const snippet = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
                throw new Error(
                    "Supabase returned HTML (" + response.status + "). " +
                    "Verify SUPABASE_URL and that the Supabase project is active. Snippet: " + snippet
                );
            }

            return response;
        } catch (err) {
            if (err && err.name === "AbortError") {
                throw new Error("Supabase request timed out after " + timeoutMs + "ms.");
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    };
}

function getSupabaseServiceRoleClient() {
    const url = getSupabaseUrl();
    const resolved = getValidatedServiceRoleKey();

    if (!url || !resolved.key) {
        throw new Error(
            "Supabase service role is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to a service_role JWT or sb_secret_ key."
        );
    }

    const serviceRoleKey = validateServiceRoleKey(resolved.key, resolved.source);
    const options = {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: {
            fetch: createTimeoutFetch(SUPABASE_FETCH_TIMEOUT_MS)
        }
    };

    if (isSupabaseJwtKey(serviceRoleKey)) {
        options.global.headers = {
            Authorization: "Bearer " + serviceRoleKey
        };
    }

    return createClient(url, serviceRoleKey, options);
}

module.exports = {
    getSupabaseServiceRoleClient,
    getSupabaseAdmin: getSupabaseServiceRoleClient,
    normalizeSupabaseErrorMessage,
    SUPABASE_FETCH_TIMEOUT_MS
};
