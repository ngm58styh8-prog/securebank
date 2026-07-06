const { setCors, handleOptions } = require("./lib/cors");
const { createAndSendVerification } = require("./lib/verification");

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
        const result = await createAndSendVerification(email, { enforceCooldown: false });

        res.status(result.status).json(result);
    } catch (err) {
        console.error("[send-verification]", err);
        res.status(500).json({ ok: false, error: err.message || "Failed to send verification email." });
    }
};
