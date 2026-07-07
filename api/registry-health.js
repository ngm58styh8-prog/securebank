const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const {
    isRegistryConfigured,
    registryConfigError,
    loadAllAccounts
} = require("../server-lib/registry");
const { getSupabaseEnvChecks } = require("../server-lib/supabase-config");

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const configured = isRegistryConfigured();
    const checks = getSupabaseEnvChecks();
    let tableReady = false;
    let tableError = null;
    let accountCount = 0;

    if (configured) {
        try {
            const accounts = await loadAllAccounts();
            tableReady = true;
            accountCount = Object.keys(accounts).length;
        } catch (err) {
            tableReady = false;
            tableError = err && err.message ? err.message : "Failed to read user_accounts table.";
        }
    }

    const ready = configured && tableReady;

    res.status(ready ? 200 : 503).json({
        ok: ready,
        configured: configured,
        tableReady: tableReady,
        tableError: tableError,
        accountCount: accountCount,
        checks: checks,
        message: ready
            ? "Account registry is online (" + accountCount + " user account" +
                (accountCount === 1 ? "" : "s") + " on server)."
            : (tableError
                ? "Supabase registry table missing or unreadable. Run supabase/migrations/002_app_registry.sql."
                : registryConfigError().error)
    });
};
