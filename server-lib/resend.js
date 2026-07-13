const { Resend } = require("resend");
const {
    getFromAddress,
    getReplyTo,
    getDeliverabilityWarnings,
    buildVerificationEmailContent
} = require("./email-deliverability");

let resendClient = null;

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

    const category = (options.tags || []).find(function(tag) {
        return tag && tag.name === "category";
    });
    const logMeta = {
        to: options.to,
        subject: options.subject,
        category: category && category.value ? category.value : "transactional"
    };

    console.log("[resend] attempt", logMeta);

    const resend = getResendClient();
    const payload = {
        from: options.from || getFromAddress(),
        to: options.to,
        replyTo: options.replyTo || getReplyTo(),
        subject: options.subject,
        text: options.text,
        html: options.html,
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
    getDeliverabilityWarnings
};
