const { Resend } = require("resend");
const {
    getFromAddress,
    getReplyTo,
    getDeliverabilityWarnings,
    buildVerificationEmailContent
} = require("./email-deliverability");

let resendClient = null;

const DEMO_SUBJECT_PREFIX = "[DEMO] ";
const DEMO_NOTICE = "Demo project — GlobalVest is not a real bank. No real money is involved; balances, returns and transactions are simulated. Do not send real funds.";
const DEMO_NOTICE_HTML =
    '<div style="margin:0;padding:12px 16px;background-color:#F5B700;color:#1F1600;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;font-weight:700;text-align:center;">' +
    DEMO_NOTICE +
    "</div>";

function applyDemoDisclaimer(options) {
    const subject = String(options.subject || "");
    const text = String(options.text || "");
    let html = options.html ? String(options.html) : "";
    if (html) {
        const bodyOpen = html.match(/<body[^>]*>/i);
        html = bodyOpen
            ? html.replace(bodyOpen[0], bodyOpen[0] + DEMO_NOTICE_HTML)
            : DEMO_NOTICE_HTML + html;
    }
    return {
        subject: subject.indexOf(DEMO_SUBJECT_PREFIX) === 0 ? subject : DEMO_SUBJECT_PREFIX + subject,
        text: text ? text + "\n\n---\n" + DEMO_NOTICE : DEMO_NOTICE,
        html: html || undefined
    };
}

function getResendClient() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error("Resend is not configured. Set RESEND_API_KEY.");
    }
    if (!resendClient) {
        resendClient = new Resend(apiKey);
    }
    return resendClient;
}

/**
 * Production Resend sender — multipart HTML/text, aligned headers, no open tracking.
 */
async function sendTransactionalEmail(options) {
    const warnings = getDeliverabilityWarnings();
    if (warnings.length) {
        console.warn("[resend] deliverability:", warnings.join(" "));
    }

    const demo = applyDemoDisclaimer(options);
    const category = (options.tags || []).find(function(tag) {
        return tag && tag.name === "category";
    });
    const logMeta = {
        to: options.to,
        subject: demo.subject,
        category: category && category.value ? category.value : "transactional"
    };

    console.log("[resend] attempt", logMeta);

    const resend = getResendClient();
    const payload = {
        from: options.from || getFromAddress(),
        to: options.to,
        replyTo: options.replyTo || getReplyTo(),
        subject: demo.subject,
        text: demo.text,
        html: demo.html,
        headers: options.headers || {},
        tags: options.tags || []
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
        console.error("[resend] failed", Object.assign({}, logMeta, {
            error: error.message || "Failed to send email via Resend."
        }));
        throw new Error(error.message || "Failed to send email via Resend.");
    }

    console.log("[resend] sent", Object.assign({}, logMeta, {
        id: data && data.id ? data.id : null
    }));

    return data;
}

async function sendVerificationEmail(to, code) {
    const content = buildVerificationEmailContent(code, to);

    return sendTransactionalEmail({
        to: to,
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: content.headers,
        tags: content.tags
    });
}

module.exports = {
    sendTransactionalEmail,
    sendVerificationEmail,
    applyDemoDisclaimer,
    getDeliverabilityWarnings
};
