const { setCors, handleOptions } = require("../server-lib/cors");
const { completeOAuthSignIn } = require("../server-lib/oauth-auth");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const accessToken = String(body.access_token || body.accessToken || "").trim();
        if (!accessToken) {
            res.status(400).json({ ok: false, error: "Missing access_token." });
            return;
        }

        const result = await completeOAuthSignIn(accessToken);
        if (!result.ok) {
            res.status(403).json(result);
            return;
        }

        res.status(200).json({
            ok: true,
            email: result.email,
            account: result.account,
            isNew: result.isNew,
            provider: result.provider
        });
    } catch (err) {
        const message = err && err.message ? err.message : "OAuth sign-in failed.";
        const status = message.indexOf("not configured") !== -1 ? 503 : 400;
        res.status(status).json({ ok: false, error: message });
    }
};
