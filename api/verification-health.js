const { setCors, handleOptions } = require("../server-lib/cors");
const { getSupabaseEnvChecks, getMissingSupabaseEnv } = require("../server-lib/supabase-config");
const { getDeliverabilityReport } = require("../server-lib/email-deliverability");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const checks = getSupabaseEnvChecks();
    const missing = getMissingSupabaseEnv();
    const report = getDeliverabilityReport();
    const configured = missing.length === 0;

    res.status(configured ? 200 : 503).json({
        ok: configured,
        configured: configured,
        inboxReady: configured && report.inboxReady,
        checks: checks,
        missing: missing,
        deliverabilityWarnings: report.warnings,
        authenticationAlignment: report.authenticationAlignment,
        dns: report.dns,
        recommendations: report.recommendations,
        security: report.security,
        configuredSender: report.configured,
        message: !configured
            ? "Missing or invalid configuration: " + missing.join(", ")
            : report.warnings.length
                ? "Email verification works, but sender settings may land in spam: " + report.warnings[0]
                : "Email verification is configured for inbox delivery."
    });
};
