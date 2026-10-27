const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const { isRegistryConfigured, registryConfigError } = require("../server-lib/registry");
const { assertAdminAuthorized } = require("../server-lib/admin-auth");
const {
    listInvestmentEmails,
    retryInvestmentEmail,
    processDueNotifications,
    getInvestmentSender
} = require("../server-lib/investment-confirmation-emails");

function parseBody(req) {
    if (typeof req.body === "string") {
        try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body || {};
}

function configurationStatus() {
    const sender = getInvestmentSender();
    return {
        resendConfigured: !!String(process.env.RESEND_API_KEY || "").trim(),
        webhookSecretConfigured: !!String(process.env.RESEND_WEBHOOK_SECRET || "").trim(),
        adminAlertRecipientsConfigured: !!String(process.env.INVESTMENT_EMAIL_ADMIN_ALERT_TO || "").trim(),
        cronSecretConfigured: !!String(process.env.CRON_SECRET || "").trim(),
        sender: sender.from,
        senderFallback: sender.usingFallback,
        senderWarning: sender.warning
    };
}

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (!isRegistryConfigured()) {
        res.status(503).json(registryConfigError());
        return;
    }

    try {
        if (req.method === "GET") {
            const query = req.query || {};
            await assertAdminAuthorized(req, {
                adminEmail: query.adminEmail,
                adminPassword: query.adminPassword
            });

            if (query.action === "list" || !query.action) {
                const result = await listInvestmentEmails({
                    status: query.status ? String(query.status).toLowerCase() : "",
                    q: query.q,
                    limit: query.limit
                });
                result.config = configurationStatus();
                res.status(200).json(result);
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid GET action." });
            return;
        }

        if (req.method === "POST") {
            const body = parseBody(req);
            await assertAdminAuthorized(req, body);

            if (body.action === "retry" && body.id) {
                const result = await retryInvestmentEmail(String(body.id));
                res.status(result.ok ? 200 : 400).json(result);
                return;
            }

            if (body.action === "process") {
                const result = await processDueNotifications({ limit: 25 });
                res.status(200).json(result);
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid POST action." });
            return;
        }

        res.status(405).json({ ok: false, error: "Method not allowed." });
    } catch (err) {
        const status = err && err.statusCode ? err.statusCode : 500;
        res.status(status).json({
            ok: false,
            error: err && err.message ? err.message : "Investment email request failed."
        });
    }
};
