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

function logEmailAttempt(type, to, context) {
    console.log(LOG_PREFIX, "attempt", {
        type: type,
        to: to,
        reference: context && context.reference ? context.reference : null
    });
}

function logEmailSuccess(type, to, data, context) {
    console.log(LOG_PREFIX, "sent", {
        type: type,
        to: to,
        id: data && data.id ? data.id : null,
        reference: context && context.reference ? context.reference : null
    });
}

function logEmailFailure(type, to, error, context) {
    console.error(LOG_PREFIX, "failed", {
        type: type,
        to: to,
        reference: context && context.reference ? context.reference : null,
        error: error && error.message ? error.message : String(error || "Unknown error")
    });
}

async function sendTransferEmail(to, subject, body, category, context) {
    const content = buildTransactionalEmailContent(subject, body, to, {
        category: category || "transactional",
        headline: subject,
        referenceId: context && context.reference
            ? "gv-transfer-" + context.reference + "-" + category
            : undefined
    });

    logEmailAttempt(category, to, context);

    try {
        const data = await sendTransactionalEmail({
            to: to,
            subject: content.subject,
            text: content.text,
            html: content.html,
            headers: content.headers,
            tags: content.tags
        });
        logEmailSuccess(category, to, data, context);
        return { sent: true, id: data && data.id ? data.id : null };
    } catch (err) {
        logEmailFailure(category, to, err, context);
        return { sent: false, error: err && err.message ? err.message : String(err) };
    }
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
    const context = { reference: transfer.reference || transfer.id || null };
    const result = {
        sent: false,
        skipped: false,
        sender: null,
        recipient: null,
        error: null
    };

    const senderBody =
        "Hi " + getDisplayName(senderAccount, transfer.senderEmail) + ",\n\n" +
        "Your GlobalVest transfer was successful.\n\n" +
        "Amount: " + amountLabel + "\n" +
        "Recipient: " + transfer.recipientEmail + "\n" +
        "Reference: " + transfer.reference + "\n" +
        (transfer.note ? "Note: " + transfer.note + "\n\n" : "\n") +
        "If you did not authorize this transfer, contact " + supportEmail + " immediately.\n\n" +
        BRAND_NAME + " Security Team";

    const recipientBody =
        "Hi " + getDisplayName(recipientAccount, transfer.recipientEmail) + ",\n\n" +
        "You received funds in your GlobalVest account.\n\n" +
        "Amount: " + amountLabel + "\n" +
        "From: " + transfer.senderEmail + "\n" +
        "Reference: " + transfer.reference + "\n" +
        (transfer.note ? "Note: " + transfer.note + "\n\n" : "\n") +
        "Log in to view your updated balance.\n\n" +
        BRAND_NAME + " Team";

    result.sender = await sendTransferEmail(
        transfer.senderEmail,
        BRAND_NAME + " — Transfer Sent",
        senderBody,
        "send-money-sent",
        context
    );

    result.recipient = await sendTransferEmail(
        transfer.recipientEmail,
        BRAND_NAME + " — Funds Received",
        recipientBody,
        "send-money-received",
        context
    );

    result.sent = !!(result.sender.sent && result.recipient.sent);
    if (!result.sender.sent && result.sender.error) {
        result.error = result.sender.error;
    } else if (!result.recipient.sent && result.recipient.error) {
        result.error = result.recipient.error;
    }

    if (result.sent) {
        console.log(LOG_PREFIX, "completed", { reference: transfer.reference });
    } else {
        console.error(LOG_PREFIX, "partial-or-failed", {
            reference: transfer.reference,
            senderSent: !!(result.sender && result.sender.sent),
            recipientSent: !!(result.recipient && result.recipient.sent),
            error: result.error
        });
    }

    return result;
}

module.exports = {
    sendTransferEmailsSafely
};
