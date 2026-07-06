const { setCors, handleOptions } = require("../server-lib/cors");
const { verifyEmailCode } = require("../server-lib/verification");

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
        const code = body && body.code;
        const result = await verifyEmailCode(email, code);

        res.status(result.status).json(result);
    } catch (err) {
        console.error("[verify-email]", err);
        res.status(500).json({ ok: false, error: err.message || "Failed to verify email." });
    }
};
