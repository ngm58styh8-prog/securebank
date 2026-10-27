const { isRegistryConfigured, registryConfigError } = require("../../server-lib/registry");
const { processDueNotifications } = require("../../server-lib/investment-confirmation-emails");

function authorizeCron(req) {
    const secret = String(process.env.CRON_SECRET || "").trim();
    if (!secret) {
        return process.env.NODE_ENV !== "production";
    }
    const auth = String(req.headers.authorization || "").trim();
    if (auth === "Bearer " + secret) return true;
    return String(req.headers["x-cron-secret"] || "").trim() === secret;
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed." });
        return;
    }

    if (!authorizeCron(req)) {
        res.status(401).json({ ok: false, error: "Unauthorized cron request." });
        return;
    }

    if (!isRegistryConfigured()) {
        res.status(503).json(registryConfigError());
        return;
    }

    try {
        const result = await processDueNotifications({ limit: 25 });
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err && err.message ? err.message : "Investment email queue run failed."
        });
    }
};
