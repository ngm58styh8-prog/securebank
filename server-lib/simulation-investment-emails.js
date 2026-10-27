const { sendTransactionalEmail } = require("./resend");
const { buildTransactionalEmailContent } = require("./email-deliverability");

const SUBJECT = "GlobalVest — Investment Earnings Credit";

function formatStatementDate(iso) {
    try {
        return new Date(iso).toLocaleString("en-US", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "UTC"
        }) + " UTC";
    } catch (e) {
        return String(iso || "");
    }
}

function buildSimulationEarningsEmailContent(options) {
    options = options || {};
    const name = options.customerName || "Valued Customer";
    const assetName = options.assetName || "Investment";
    const invested = Number(options.investedAmount || 0).toFixed(2);
    const earned = Number(options.creditAmount || 0).toFixed(2);
    const total = Number(options.totalSimulatedEarned || 0).toFixed(2);
    const dateStr = formatStatementDate(options.calculationDate || new Date().toISOString());

    const body =
        "Dear " + name + ",\n\n" +
        "This is a confirmation that earnings have been credited to your GlobalVest investment account.\n\n" +
        "Account activity summary\n\n" +
        "Product: " + assetName + "\n" +
        "Principal balance: $" + invested + "\n" +
        "Earnings credited this period: $" + earned + "\n" +
        "Cumulative earnings (this position): $" + total + "\n" +
        "Posting date: " + dateStr + "\n\n" +
        "You can review balances, positions, and transaction history by signing in to Online Banking.\n\n" +
        "If you did not expect this activity, contact GlobalVest Client Services immediately.\n\n" +
        "Thank you for banking with GlobalVest.\n\n" +
        "GlobalVest Client Services";

    return { subject: SUBJECT, body: body };
}

async function sendSimulationEarningsEmailSafely(options) {
    const to = String(options.to || "").trim().toLowerCase();
    if (!to || to.indexOf("@") === -1) {
        return { sent: false, skipped: true, error: "Missing recipient." };
    }
    if (options.emailSentAt) {
        return { sent: false, duplicate: true };
    }

    const content = buildSimulationEarningsEmailContent(options);
    try {
        const wrapped = buildTransactionalEmailContent(
            content.subject,
            content.body,
            to,
            { category: "investment-earnings", headline: "Investment earnings credit" }
        );
        const data = await sendTransactionalEmail({
            to: to,
            subject: wrapped.subject,
            text: wrapped.text,
            html: wrapped.html,
            headers: wrapped.headers,
            tags: wrapped.tags
        });
        return { sent: true, id: data && data.id ? data.id : null };
    } catch (err) {
        return { sent: false, error: err && err.message ? err.message : String(err) };
    }
}

module.exports = {
    SUBJECT,
    buildSimulationEarningsEmailContent,
    sendSimulationEarningsEmailSafely
};
