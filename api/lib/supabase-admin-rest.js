const {
    getSupabaseUrl,
    getValidatedSupabaseAdminKey,
    buildSupabaseHeaders
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

async function supabaseRest(method, path, options) {
    options = options || {};
    const baseUrl = getSupabaseUrl().replace(/\/$/, "");
    const admin = getValidatedSupabaseAdminKey();

    if (!baseUrl || !admin.key) {
        throw new Error(
            "Supabase is not configured. Set SUPABASE_URL and one of SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY."
        );
    }

    const headers = Object.assign({}, buildSupabaseHeaders(admin.key), options.headers || {});
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

async function supabaseRpc(functionName, params, options) {
    options = options || {};
    const baseUrl = getSupabaseUrl().replace(/\/$/, "");
    const admin = getValidatedSupabaseAdminKey();

    if (!baseUrl || !admin.key) {
        throw new Error("Supabase is not configured.");
    }

    const headers = Object.assign({}, buildSupabaseHeaders(admin.key), options.headers || {});
    headers.Prefer = options.prefer || "return=representation";

    const res = await fetch(baseUrl + "/rest/v1/rpc/" + functionName, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(params || {})
    });

    const data = await parseResponse(res);
    if (!res.ok) {
        const message =
            (data && data.message) ||
            (data && data.error) ||
            (typeof data === "string" ? data : null) ||
            ("Supabase RPC failed (" + res.status + ")");
        const err = new Error(message);
        err.status = res.status;
        err.details = data;
        throw err;
    }

    return data;
}

module.exports = {
    supabaseRest,
    supabaseRpc
};
