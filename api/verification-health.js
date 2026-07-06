const { setCors, handleOptions } = require("./lib/cors");
const { getSupabaseEnvChecks, getMissingSupabaseEnv } = require("./lib/supabase-config");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const checks = getSupabaseEnvChecks();
    const missing = getMissingSupabaseEnv();

    res.status(missing.length ? 503 : 200).json({
        ok: missing.length === 0,
        configured: missing.length === 0,
        checks: checks,
        missing: missing,
        message: missing.length === 0
            ? "Email verification is configured with Supabase service role."
            : "Missing or invalid configuration: " + missing.join(", ")
    });
};
