const { setCors, handleOptions } = require("./lib/cors");
const { getSupabaseEnvChecks, getMissingSupabaseEnv } = require("./lib/supabase-config");

function envStatus(name) {
    const value = process.env[name];
    return { set: !!value && String(value).trim().length > 0 };
}

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const supabaseChecks = getSupabaseEnvChecks();
    const checks = {
        SUPABASE_URL: supabaseChecks.SUPABASE_URL,
        SUPABASE_ADMIN_KEY: supabaseChecks.SUPABASE_ADMIN_KEY,
        RESEND_API_KEY: envStatus("RESEND_API_KEY"),
        RESEND_FROM_EMAIL: envStatus("RESEND_FROM_EMAIL")
    };

    const missing = getMissingSupabaseEnv().concat(
        ["RESEND_API_KEY", "RESEND_FROM_EMAIL"].filter(function(key) {
            return !checks[key].set;
        })
    );

    res.status(missing.length ? 503 : 200).json({
        ok: missing.length === 0,
        configured: missing.length === 0,
        checks: checks,
        missing: missing,
        message: missing.length === 0
            ? "Email verification is configured."
            : "Missing environment variables: " + missing.join(", ")
    });
};
