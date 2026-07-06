const { setCors, handleOptions } = require("./lib/cors");

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

    const checks = {
        SUPABASE_URL: envStatus("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: envStatus("SUPABASE_SERVICE_ROLE_KEY"),
        RESEND_API_KEY: envStatus("RESEND_API_KEY"),
        RESEND_FROM_EMAIL: envStatus("RESEND_FROM_EMAIL")
    };

    const missing = Object.keys(checks).filter(function(key) {
        return !checks[key].set;
    });

    res.status(missing.length ? 503 : 200).json({
        ok: missing.length === 0,
        configured: missing.length === 0,
        missing: missing,
        message: missing.length === 0
            ? "Email verification is configured."
            : "Missing environment variables: " + missing.join(", ")
    });
};
