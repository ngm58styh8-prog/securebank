const {
    escapeHtml,
    getSiteUrl,
    getSupportEmail,
    getPhysicalAddress
} = require("./email-deliverability");
const { formatDepositCurrencyLabel } = require("./crypto-deposit-config");

const SUBJECT = "GlobalVest | Deposit Successfully Credited";
const SENDER_DISPLAY_NAME = "GlobalVest Accounts";

const COLORS = {
    background: "#020B09",
    card: "#071A15",
    primary: "#00E89B",
    text: "#FFFFFF",
    muted: "#9FB8AF",
    border: "#123A2E",
    buttonText: "#020B09"
};

function formatUsd(amount) {
    const n = Number(amount);
    return "$" + (isFinite(n) ? n : 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function splitDateTime(iso) {
    const d = new Date(iso || Date.now());
    if (isNaN(d.getTime())) return { date: "—", time: "—" };
    return {
        date: d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) + " (UTC)",
        time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC"
    };
}

function buildDepositCreditedEmail(data) {
    data = data || {};
    const supportEmail = getSupportEmail();
    const siteUrl = getSiteUrl();
    const physicalAddress = getPhysicalAddress();
    const creditedAt = data.creditedAt || new Date().toISOString();
    const parts = splitDateTime(creditedAt);
    const simulated = !!data.simulated;
    const currencyLabel = formatDepositCurrencyLabel(data.currency || "BTC");
    const viewUrl = String(data.viewUrl || siteUrl + "/dashboard.html").trim();

    const textLines = [
        "Dear " + (data.customerName || "Valued Customer") + ",",
        "",
        "We are pleased to confirm that your deposit has been successfully verified and credited to your GlobalVest account.",
        "",
        "DEPOSIT DETAILS",
        "",
        "Deposit Amount: " + formatUsd(data.amount),
        "Currency: " + currencyLabel,
        "Transaction Reference: " + (data.reference || "—"),
        "Payment Method: " + (data.paymentMethod || "Cryptocurrency"),
        "Date: " + parts.date,
        "Time: " + parts.time,
        "Deposit Status: Completed",
        "Updated Account Balance: " + formatUsd(data.balanceAfter),
        simulated ? "\nNote: This credit was processed in a simulated environment.\n" : "",
        "",
        "VIEW TRANSACTION: " + viewUrl,
        "",
        "Thank you for choosing GlobalVest.",
        "GlobalVest Accounts Team",
        "",
        "If you do not recognize this activity, please contact support at " + supportEmail + ".",
        physicalAddress
    ].filter(function(line) { return line !== ""; });

    const notice = simulated
        ? "This deposit credit is simulated for demonstration purposes and does not represent real funds received."
        : "Funds are credited only after verified receipt.";

    const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const c = COLORS;
    const rows = [
        ["Deposit Amount", formatUsd(data.amount)],
        ["Currency", currencyLabel],
        ["Transaction Reference", data.reference || "—"],
        ["Payment Method", data.paymentMethod || "Cryptocurrency"],
        ["Date", parts.date],
        ["Time", parts.time],
        ["Deposit Status", "Completed"],
        ["Updated Account Balance", formatUsd(data.balanceAfter)]
    ].map(function(row, index) {
        const border = index === 0 ? "" : "border-top:1px solid " + c.border + ";";
        return "<tr><td style=\"padding:12px 0;" + border + "color:" + c.muted + ";font-size:13px;\">" +
            escapeHtml(row[0]) + "</td><td align=\"right\" style=\"padding:12px 0 12px 16px;" + border +
            "color:" + c.text + ";font-weight:600;text-align:right;\">" + escapeHtml(row[1]) + "</td></tr>";
    }).join("");

    const html =
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<title>" + escapeHtml(SUBJECT) + "</title></head>" +
        "<body style=\"margin:0;background:" + c.background + ";color:" + c.text + ";font-family:" + font + ";\">" +
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:" + c.background + ";\"><tr><td align=\"center\" style=\"padding:32px 16px;\">" +
        "<table width=\"100%\" style=\"max-width:600px;background:" + c.card + ";border:1px solid " + c.border + ";border-radius:14px;padding:32px;\">" +
        "<tr><td><p style=\"color:" + c.primary + ";letter-spacing:0.12em;font-size:12px;margin:0 0 8px;\">DEPOSIT CREDITED</p>" +
        "<h1 style=\"margin:0 0 16px;font-size:24px;\">Deposit Successfully Credited</h1>" +
        "<p style=\"color:" + c.muted + ";line-height:1.6;\">Dear " + escapeHtml(data.customerName || "Valued Customer") + ",</p>" +
        "<p style=\"line-height:1.6;\">We are pleased to confirm that your deposit has been successfully verified and credited to your GlobalVest account.</p>" +
        "<p style=\"color:" + c.primary + ";font-size:12px;letter-spacing:0.1em;margin:24px 0 8px;\">DEPOSIT DETAILS</p>" +
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">" + rows + "</table>" +
        "<p style=\"margin:16px 0 24px;padding:10px 14px;border-left:3px solid " + c.primary + ";color:" + c.muted + ";font-size:13px;\">" + escapeHtml(notice) + "</p>" +
        "<a href=\"" + escapeHtml(viewUrl) + "\" style=\"display:inline-block;background:" + c.primary + ";color:" + c.buttonText + ";padding:14px 28px;border-radius:10px;font-weight:700;text-decoration:none;\">VIEW TRANSACTION</a>" +
        "<p style=\"margin:24px 0 0;font-size:12px;color:" + c.muted + ";\">Thank you for choosing GlobalVest.<br>GlobalVest Accounts Team<br><br>This is an automated transactional email.<br>If you do not recognize this activity, contact " +
        escapeHtml(supportEmail) + ".</p></td></tr></table></td></tr></table></body></html>";

    return { subject: SUBJECT, text: textLines.join("\n"), html: html };
}

module.exports = {
    SUBJECT,
    SENDER_DISPLAY_NAME,
    buildDepositCreditedEmail
};
