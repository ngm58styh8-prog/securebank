const { setCors, handleOptions } = require("../server-lib/cors");
const { getOAuthPublicConfig } = require("../server-lib/oauth-auth");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const origin = req.headers.origin ||
        req.headers.referer ||
        process.env.RESEND_SITE_URL ||
        "https://globalvestbank.com";

    res.status(200).json(getOAuthPublicConfig(origin));
};
