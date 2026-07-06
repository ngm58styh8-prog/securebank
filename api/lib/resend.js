const { Resend } = require("resend");

function getResendClient() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error("Resend is not configured. Set RESEND_API_KEY.");
    }
    return new Resend(apiKey);
}

function getFromAddress() {
    return process.env.RESEND_FROM_EMAIL || "GlobalVest <onboarding@resend.dev>";
}

async function sendVerificationEmail(to, code) {
    const resend = getResendClient();
    const from = getFromAddress();

    const { data, error } = await resend.emails.send({
        from: from,
        to: to,
        subject: "Verify your GlobalVest account",
        text:
            "Your GlobalVest verification code is:\n\n" +
            code +
            "\n\nThis code expires in 10 minutes."
    });

    if (error) {
        throw new Error(error.message || "Failed to send verification email.");
    }

    return data;
}

module.exports = { sendVerificationEmail };
