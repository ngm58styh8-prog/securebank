const { isRegistryConfigured, registryConfigError } = require("../../server-lib/registry");
const { processAllSimulationCredits } = require("../../server-lib/simulation-investments");

function authorizeCron(req) {
    const secret = String(process.env.CRON_SECRET || "").trim();
    if (!secret) {
        return process.env.NODE_ENV !== "production";
    }
    const auth = String(req.headers.authorization || "").trim();
    if (auth === "Bearer " + secret) return true;
    const header = String(req.headers["x-cron-secret"] || "").trim();
    if (header === secret) return true;
    const query = req.query && req.query.secret ? String(req.query.secret).trim() : "";
    return query === secret;
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
        const result = await processAllSimulationCredits();
        res.status(200).json({
            ok: true,
            marketCredits: result.marketCredits,
            gold: result.gold,
            job: result.job,
            errors: result.errors
        });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err && err.message ? err.message : "Investment credit cron failed."
        });
    }
};
