const { setRegistryCors, handleRegistryOptions } = require("./lib/registry-cors");
const { isRegistryConfigured, registryConfigError } = require("./lib/registry");
const { getSupabaseEnvChecks } = require("./lib/supabase-config");

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const configured = isRegistryConfigured();
    const checks = getSupabaseEnvChecks();

    res.status(configured ? 200 : 503).json({
        ok: configured,
        configured: configured,
        checks: checks,
        message: configured
            ? "Account registry is configured with Supabase service role."
            : registryConfigError().error
    });
};
