const {
    verifyWebhookSignature,
    applyProviderEvent
} = require("../server-lib/investment-confirmation-emails");

function readRawBody(req) {
    if (typeof req.body === "string") return Promise.resolve(req.body);
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
    if (req.rawBody != null) return Promise.resolve(String(req.rawBody));
    return new Promise(function(resolve, reject) {
        const chunks = [];
        req.on("data", function(chunk) { chunks.push(Buffer.from(chunk)); });
        req.on("end", function() { resolve(Buffer.concat(chunks).toString("utf8")); });
        req.on("error", reject);
    });
}

// Signature verification needs the exact bytes Resend signed, so Vercel's body parser is disabled.
module.exports = Object.assign(async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed." });
        return;
    }

    const secret = String(process.env.RESEND_WEBHOOK_SECRET || "").trim();
    if (!secret) {
        res.status(503).json({ ok: false, error: "RESEND_WEBHOOK_SECRET is not configured." });
        return;
    }

    try {
        const rawBody = await readRawBody(req);
        const verification = verifyWebhookSignature(rawBody, req.headers || {}, secret);
        if (!verification.ok) {
            res.status(401).json({ ok: false, error: verification.error });
            return;
        }

        let event;
        try {
            event = JSON.parse(rawBody);
        } catch (e) {
            res.status(400).json({ ok: false, error: "Invalid JSON." });
            return;
        }

        const result = await applyProviderEvent(event);
        res.status(200).json(result);
    } catch (err) {
        console.error("[resend-webhook] failed", err && err.message ? err.message : err);
        // Non-2xx makes Resend retry the delivery event.
        res.status(500).json({ ok: false, error: "Webhook processing failed." });
    }
}, { config: { api: { bodyParser: false } } });
