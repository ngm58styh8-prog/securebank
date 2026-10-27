const {
    escapeHtml,
    getSiteUrl,
    getSupportEmail,
    getPhysicalAddress
} = require("./email-deliverability");
const { formatDepositCurrencyLabel } = require("./crypto-deposit-config");

const SUBJECT = "GlobalVest | Deposit Confirmation";
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
    const logoUrl = siteUrl + "/assets/globalvest-logo-emerald.png";

    const textLines = [
        "Dear " + (data.customerName || "Valued Customer") + ",",
        "",
        "Your deposit has been successfully verified and credited to your GlobalVest account.",
        "",
        "DEPOSIT DETAILS",
        "",
        "Deposit Amount: " + formatUsd(data.amount),
        "Currency: " + currencyLabel,
        "Transaction Reference: " + (data.reference || "—"),
        "Payment Method: " + (data.paymentMethod || "Cryptocurrency"),
        "Date: " + parts.date,
        "Status: Completed",
        "Updated Account Balance: " + formatUsd(data.balanceAfter),
        simulated ? "\nNote: This credit was processed in a simulated environment.\n" : "",
        "",
        "VIEW MY ACCOUNT: " + viewUrl,
        "",
        "Thank you for choosing GlobalVest.",
        "GlobalVest Accounts Team",
        "",
        "If you did not authorize this transaction, contact support at " + supportEmail + ".",
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
        ["Status", "Completed"],
        ["Updated Account Balance", formatUsd(data.balanceAfter)]
    ].map(function(row, index) {
        const border = index === 0 ? "" : "border-top:1px solid " + c.border + ";";
        return "<tr><td style=\"padding:12px 0;" + border + "color:" + c.muted + ";font-size:13px;\">" +
            escapeHtml(row[0]) + "</td><td align=\"right\" style=\"padding:12px 0 12px 16px;" + border +
            "color:" + c.text + ";font-weight:600;text-align:right;word-break:break-word;\">" + escapeHtml(row[1]) + "</td></tr>";
    }).join("");

    const html =
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<title>" + escapeHtml(SUBJECT) + "</title></head>" +
        "<body style=\"margin:0;background:" + c.background + ";color:" + c.text + ";font-family:" + font + ";\">" +
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\" style=\"background:" + c.background + ";\"><tr><td align=\"center\" style=\"padding:24px 12px;\">" +
        "<table width=\"100%\" role=\"presentation\" style=\"max-width:600px;background:" + c.card + ";border:1px solid " + c.border + ";border-radius:14px;padding:28px 20px;\">" +
        "<tr><td><img src=\"" + escapeHtml(logoUrl) + "\" alt=\"GlobalVest\" width=\"140\" style=\"display:block;border:0;max-width:140px;height:auto;margin:0 0 20px;\" />" +
        "<h1 style=\"margin:0 0 12px;font-size:22px;line-height:1.3;\">Deposit Confirmation</h1>" +
        "<p style=\"color:" + c.muted + ";line-height:1.6;font-size:15px;\">Dear " + escapeHtml(data.customerName || "Valued Customer") + ",</p>" +
        "<p style=\"line-height:1.6;font-size:15px;\">Your deposit has been successfully verified and credited to your GlobalVest account.</p>" +
        "<p style=\"color:" + c.primary + ";font-size:12px;letter-spacing:0.1em;margin:20px 0 8px;\">DEPOSIT DETAILS</p>" +
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\">" + rows + "</table>" +
        "<p style=\"margin:16px 0 20px;padding:10px 14px;border-left:3px solid " + c.primary + ";color:" + c.muted + ";font-size:13px;line-height:1.5;\">" + escapeHtml(notice) + "</p>" +
        "<a href=\"" + escapeHtml(viewUrl) + "\" style=\"display:block;max-width:100%;box-sizing:border-box;text-align:center;background:" + c.primary + ";color:" + c.buttonText + ";padding:14px 20px;border-radius:10px;font-weight:700;text-decoration:none;\">VIEW MY ACCOUNT</a>" +
        "<p style=\"margin:20px 0 0;font-size:12px;line-height:1.5;color:" + c.muted + ";\">You can now view your updated account information in your dashboard.<br><br>Thank you for choosing GlobalVest.<br>GlobalVest Accounts Team<br><br>If you did not authorize this transaction, contact " +
        escapeHtml(supportEmail) + ".</p></td></tr></table></td></tr></table></body></html>";

    return { subject: SUBJECT, text: textLines.join("\n"), html: html };
}

module.exports = {
    SUBJECT,
    SENDER_DISPLAY_NAME,
    buildDepositCreditedEmail
};
