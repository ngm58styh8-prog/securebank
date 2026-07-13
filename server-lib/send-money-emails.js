const { sendTransactionalEmail } = require("./resend");
const {
    buildTransactionalEmailContent,
    getSupportEmail,
    BRAND_NAME
} = require("./email-deliverability");

const LOG_PREFIX = "[send-money-email]";

function formatAmount(amount, currency) {
    currency = String(currency || "USD").toUpperCase();
    amount = Number(amount);
    if (currency === "USD") return "$" + amount.toFixed(2);
    if (currency === "BTC") return amount.toFixed(8) + " BTC";
    if (currency === "ETH") return amount.toFixed(6) + " ETH";
    if (currency === "USDT") return amount.toFixed(2) + " USDT";
    return String(amount);
}

function getDisplayName(account, email) {
    if (account && account.profile && account.profile.fullName) {
        return account.profile.fullName;
    }
    return email;
}

async function sendTransferEmail(to, subject, body, category) {
    const content = buildTransactionalEmailContent(subject, body, to, {
        category: category || "transactional",
        headline: subject
    });

    return sendTransactionalEmail({
        to: to,
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: content.headers,
        tags: content.tags
    });
}

async function sendTransferEmailsSafely(options) {
    options = options || {};
    const transfer = options.transfer;
    const senderAccount = options.senderAccount;
    const recipientAccount = options.recipientAccount;

    if (!transfer) {
        return { sent: false, skipped: true, error: "Missing transfer." };
    }

    const supportEmail = getSupportEmail();
    const amountLabel = formatAmount(transfer.amount, transfer.currency);
    const result = { sent: false, skipped: false, error: null };

    try {
        const senderBody =
            "Hi " + getDisplayName(senderAccount, transfer.senderEmail) + ",\n\n" +
            "Your GlobalVest transfer was successful.\n\n" +
            "Amount: " + amountLabel + "\n" +
            "Recipient: " + transfer.recipientEmail + "\n" +
            "Reference: " + transfer.reference + "\n" +
            (transfer.note ? "Note: " + transfer.note + "\n\n" : "\n") +
            "If you did not authorize this transfer, contact " + supportEmail + " immediately.\n\n" +
            BRAND_NAME + " Security Team";

        await sendTransferEmail(
            transfer.senderEmail,
            BRAND_NAME + " — Transfer Sent",
            senderBody,
            "send-money-sent"
        );

        const recipientBody =
            "Hi " + getDisplayName(recipientAccount, transfer.recipientEmail) + ",\n\n" +
            "You received funds in your GlobalVest account.\n\n" +
            "Amount: " + amountLabel + "\n" +
            "From: " + transfer.senderEmail + "\n" +
            "Reference: " + transfer.reference + "\n" +
            (transfer.note ? "Note: " + transfer.note + "\n\n" : "\n") +
            "Log in to view your updated balance.\n\n" +
            BRAND_NAME + " Team";

        await sendTransferEmail(
            transfer.recipientEmail,
            BRAND_NAME + " — Funds Received",
            recipientBody,
            "send-money-received"
        );

        result.sent = true;
        console.log(LOG_PREFIX, "sent", { reference: transfer.reference });
    } catch (err) {
        result.error = err && err.message ? err.message : String(err);
        console.error(LOG_PREFIX, "failed", { reference: transfer.reference, error: result.error });
    }

    return result;
}

module.exports = {
    sendTransferEmailsSafely
};
