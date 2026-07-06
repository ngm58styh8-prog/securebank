const {
    getSupabaseUrl,
    getValidatedServiceRoleKey,
    buildServiceRoleHeaders,
    validateServiceRoleKey
} = require("./supabase-config");

async function parseResponse(res) {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

async function supabaseServiceRoleRest(method, path, options) {
    options = options || {};
    const baseUrl = getSupabaseUrl().replace(/\/$/, "");
    const resolved = getValidatedServiceRoleKey();

    if (!baseUrl || !resolved.key) {
        throw new Error(
            "Supabase service role is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        );
    }

    const serviceRoleKey = validateServiceRoleKey(resolved.key, resolved.source);
    const headers = Object.assign({}, buildServiceRoleHeaders(serviceRoleKey), options.headers || {});
    if (options.prefer) {
        headers.Prefer = options.prefer;
    }

    const url = baseUrl + "/rest/v1/" + path;
    const res = await fetch(url, {
        method: method,
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await parseResponse(res);
    if (!res.ok) {
        const message =
            (data && data.message) ||
            (data && data.error) ||
            (typeof data === "string" ? data : null) ||
            ("Supabase request failed (" + res.status + ")");
        const err = new Error(message);
        err.status = res.status;
        err.details = data;
        throw err;
    }

    return data;
}

module.exports = {
    supabaseServiceRoleRest,
    supabaseRest: supabaseServiceRoleRest
};
