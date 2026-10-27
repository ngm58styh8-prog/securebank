const { Resend } = require("resend");
const {
    getFromAddress,
    getReplyTo,
    getDeliverabilityWarnings,
    buildVerificationEmailContent
} = require("./email-deliverability");

let resendClient = null;

/** Pass-through — transactional mail uses standard GlobalVest banking templates only. */
function applyDemoDisclaimer(options) {
    return {
        subject: String(options.subject || ""),
        text: String(options.text || ""),
        html: options.html ? String(options.html) : undefined
    };
}

function getResendClient() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        const configError = new Error("Resend is not configured. Set RESEND_API_KEY.");
        configError.code = "not_configured";
        throw configError;
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

    const outbound = applyDemoDisclaimer(options);
    const category = (options.tags || []).find(function(tag) {
        return tag && tag.name === "category";
    });
    const logMeta = {
        to: options.to,
        subject: outbound.subject,
        category: category && category.value ? category.value : "transactional"
    };

    console.log("[resend] attempt", logMeta);

    const resend = getResendClient();
    const payload = {
        from: options.from || getFromAddress(),
        to: options.to,
        replyTo: options.replyTo || getReplyTo(),
        subject: outbound.subject,
        text: outbound.text,
        html: outbound.html,
        headers: options.headers || {},
        tags: options.tags || []
    };

    const sendOptions = options.idempotencyKey
        ? { idempotencyKey: String(options.idempotencyKey) }
        : undefined;

    let result;
    try {
        result = await resend.emails.send(payload, sendOptions);
    } catch (networkErr) {
        const wrapped = new Error(networkErr && networkErr.message ? networkErr.message : "Network error sending email.");
        wrapped.code = "network_error";
        throw wrapped;
    }
    const data = result.data;
    const error = result.error;

    if (error) {
        console.error("[resend] failed", Object.assign({}, logMeta, {
            error: error.message || "Failed to send email via Resend."
        }));
        const sendError = new Error(error.message || "Failed to send email via Resend.");
        sendError.code = error.name || "provider_error";
        sendError.statusCode = error.statusCode || null;
        throw sendError;
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
