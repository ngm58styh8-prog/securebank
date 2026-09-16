const { setCors, handleOptions } = require("../server-lib/cors");
const { requestPasswordReset } = require("../server-lib/password-reset");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const result = await requestPasswordReset(body.email);
        res.status(result.status || 200).json(result);
    } catch (err) {
        console.error("[request-password-reset]", err);
        res.status(500).json({ ok: false, error: err.message || "Failed to start password reset." });
    }
};
