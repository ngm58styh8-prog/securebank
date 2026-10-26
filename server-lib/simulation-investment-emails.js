const { sendTransactionalEmail } = require("./resend");
const { buildTransactionalEmailContent } = require("./email-deliverability");

const SUBJECT = "GlobalVest — Simulated Investment Earnings Update";

function buildSimulationEarningsEmailContent(options) {
    options = options || {};
    const name = options.customerName || "Customer";
    const assetName = options.assetName || "Asset";
    const invested = Number(options.investedAmount || 0).toFixed(2);
    const earned = Number(options.creditAmount || 0).toFixed(2);
    const total = Number(options.totalSimulatedEarned || 0).toFixed(2);
    const dateStr = options.calculationDate || new Date().toISOString();

    const body =
        "Hello " + name + ",\n\n" +
        "Your GlobalVest investment simulation has completed another calculation period.\n\n" +
        "Asset: " + assetName + "\n\n" +
        "Investment Amount: $" + invested + "\n\n" +
        "Simulated Earnings: $" + earned + "\n\n" +
        "Calculation Date: " + dateStr + "\n\n" +
        "Total Simulated Earnings: $" + total + "\n\n" +
        "These figures are part of an educational investment simulation and do not represent " +
        "real funds or guaranteed returns.\n\n" +
        "Thank you,\nGlobalVest Team";

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
            { category: "simulation-earnings", headline: "Simulated Investment Earnings Update" }
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
