const { setCors, handleOptions } = require("../server-lib/cors");
const { sendTransactionalEmail } = require("../server-lib/resend");
const { buildTransactionalEmailContent } = require("../server-lib/email-deliverability");

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const to = normalizeEmail(body.to);
        const subject = String(body.subject || "").trim();
        const text = String(body.body || body.text || "").trim();
        const category = String(body.category || body.type || "transactional").trim();

        if (!isValidEmail(to)) {
            res.status(400).json({ ok: false, error: "Missing or invalid recipient email." });
            return;
        }

        if (!subject || !text) {
            res.status(400).json({ ok: false, error: "Missing subject or body." });
            return;
        }

        const content = buildTransactionalEmailContent(subject, text, to, {
            category: category,
            headline: body.headline || subject
        });

        console.log("[send-email] attempt", { to: to, subject: subject, category: category });

        const data = await sendTransactionalEmail({
            to: to,
            subject: content.subject,
            text: content.text,
            html: content.html,
            headers: content.headers,
            tags: content.tags
        });

        console.log("[send-email] sent", { to: to, id: data && data.id ? data.id : null });

        res.status(200).json({
            ok: true,
            id: data && data.id ? data.id : null,
            to: to
        });
    } catch (err) {
        const message = err && err.message ? err.message : "Failed to send email.";
        let to = null;
        try {
            const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
            to = body.to || null;
        } catch (parseErr) {
            to = null;
        }
        console.error("[send-email] failed", { to: to, error: message });
        const status = message.indexOf("not configured") !== -1 ? 503 : 500;
        res.status(status).json({ ok: false, error: message });
    }
};
