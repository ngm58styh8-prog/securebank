const { setCors, handleOptions } = require("../server-lib/cors");
const { createAndSendVerification } = require("../server-lib/verification");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        const email = body && body.email;
        const result = await createAndSendVerification(email, { enforceCooldown: true });

        res.status(result.status).json(result);
    } catch (err) {
        console.error("[resend-verification]", err);
        res.status(500).json({ ok: false, error: err.message || "Failed to resend verification email." });
    }
};
