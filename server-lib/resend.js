const { Resend } = require("resend");
const {
    getFromAddress,
    getReplyTo,
    getDeliverabilityWarnings,
    buildVerificationEmailContent
} = require("./email-deliverability");

function getResendClient() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error("Resend is not configured. Set RESEND_API_KEY.");
    }
    return new Resend(apiKey);
}

async function sendVerificationEmail(to, code) {
    const warnings = getDeliverabilityWarnings();
    if (warnings.length) {
        console.warn("[resend] deliverability:", warnings.join(" "));
    }

    const resend = getResendClient();
    const content = buildVerificationEmailContent(code, to);

    const { data, error } = await resend.emails.send({
        from: getFromAddress(),
        to: to,
        replyTo: getReplyTo(),
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: content.headers,
        tags: content.tags
    });

    if (error) {
        throw new Error(error.message || "Failed to send verification email.");
    }

    return data;
}

module.exports = { sendVerificationEmail, getDeliverabilityWarnings };
