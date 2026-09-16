const { setCors, handleOptions } = require("../server-lib/cors");
const { completePasswordReset } = require("../server-lib/password-reset");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const result = await completePasswordReset(body.email, body.code, body.newPassword);
        res.status(result.status || 200).json(result);
    } catch (err) {
        console.error("[reset-password]", err);
        res.status(500).json({ ok: false, error: err.message || "Failed to reset password." });
    }
};
