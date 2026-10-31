const {
    escapeHtml,
    getSiteUrl,
    getSupportEmail,
    getPhysicalAddress,
    BRAND_NAME
} = require("./email-deliverability");

const SUBJECT = "GlobalVest | Investment Confirmation";
const SENDER_DISPLAY_NAME = "GlobalVest Investments";

const COLORS = {
    background: "#020B09",
    card: "#071A15",
    primary: "#00E89B",
    text: "#FFFFFF",
    muted: "#9FB8AF",
    border: "#123A2E",
    buttonText: "#020B09"
};

function formatUsd(value, maxFractionDigits) {
    const n = Number(value);
    return "$" + (isFinite(n) ? n : 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: maxFractionDigits == null ? 2 : maxFractionDigits
    });
}

function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC"
    }) + " (UTC)";
}

function resolveViewUrl(rawUrl) {
    const fallback = getSiteUrl() + "/investments";
    try {
        const parsed = new URL(String(rawUrl || fallback));
        if (parsed.protocol !== "https:") return fallback;
        return parsed.toString();
    } catch (e) {
        return fallback;
    }
}

/**
 * Normalises raw payload into the display strings used by both HTML and text bodies.
 */
function buildDisplayModel(data) {
    data = data || {};
    const duration = Number(data.durationDays);
    const simulated = data.simulated !== false;
    return {
        customerName: String(data.customerName || "Valued Customer").trim() || "Valued Customer",
        assetName: String(data.assetName || "Investment"),
        reference: String(data.reference || "—"),
        amount: formatUsd(data.amount),
        planName: String(data.planName || "—"),
        duration: isFinite(duration) && duration > 0 ? duration + " Days" : "—",
        hourlyEarnings: formatUsd(data.hourlyEarnings, 4),
        totalEarnings: formatUsd(data.totalEarnings),
        totalValue: formatUsd(data.totalValue),
        startDate: formatDate(data.startDate),
        endDate: formatDate(data.endDate),
        status: "Active",
        simulated: simulated,
        viewUrl: resolveViewUrl(data.viewUrl)
    };
}

function detailRows(model) {
    const earningsLabelSuffix = model.simulated ? " (Simulated)" : "";
    return [
        ["Asset", model.assetName],
        ["Investment Reference", model.reference],
        ["Investment Amount", model.amount],
        ["Investment Plan", model.planName],
        ["Investment Duration", model.duration],
        ["Hourly Projected Earnings" + earningsLabelSuffix, model.hourlyEarnings],
        ["Total Projected Earnings" + earningsLabelSuffix, model.totalEarnings],
        ["Total Projected Value" + earningsLabelSuffix, model.totalValue],
        ["Investment Start Date", model.startDate],
        ["Expected Completion Date", model.endDate],
        ["Investment Status", model.status]
    ];
}

const SIMULATED_NOTICE =
    "This is a simulated investment. Projected earnings are simulated estimates and are not guaranteed income.";
const PROJECTION_NOTICE =
    "Projected figures are estimates based on your plan terms and are not guaranteed.";

function buildPlainText(model, supportEmail, siteUrl, physicalAddress) {
    const lines = [
        "Your Investment Has Been Confirmed",
        "",
        "Dear " + model.customerName + ",",
        "",
        "Thank you for choosing GlobalVest.",
        "",
        "Your investment has been successfully created and added to your investment portfolio.",
        "",
        "INVESTMENT DETAILS",
        ""
    ];
    detailRows(model).forEach(function(row) {
        lines.push(row[0] + ": " + row[1]);
    });
    lines.push("");
    lines.push(model.simulated ? SIMULATED_NOTICE : PROJECTION_NOTICE);
    lines.push("");
    lines.push("VIEW MY INVESTMENT: " + model.viewUrl);
    lines.push("");
    lines.push("Thank you for choosing GlobalVest.");
    lines.push("GlobalVest Investment Services");
    lines.push("");
    lines.push("This is an automated transactional email.");
    lines.push("If you did not authorize this activity, contact GlobalVest support immediately at " + supportEmail + ".");
    lines.push("");
    lines.push(siteUrl);
    lines.push(physicalAddress);
    return lines.join("\n");
}

function buildHtml(model, supportEmail, siteUrl, physicalAddress) {
    const c = COLORS;
    const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const rows = detailRows(model).map(function(row, index) {
        const isStatus = row[0] === "Investment Status";
        const valueStyle = isStatus
            ? "color:" + c.primary + ";font-weight:700;"
            : "color:" + c.text + ";font-weight:600;";
        const border = index === 0 ? "" : "border-top:1px solid " + c.border + ";";
        return (
            "<tr>" +
            '<td class="gv-label" style="padding:12px 0;' + border + "font-family:" + font + ";font-size:13px;line-height:1.4;color:" + c.muted + ';" valign="top">' +
            escapeHtml(row[0]) + "</td>" +
            '<td class="gv-value" align="right" style="padding:12px 0 12px 16px;' + border + "font-family:" + font + ";font-size:14px;line-height:1.4;" + valueStyle + 'text-align:right;" valign="top">' +
            escapeHtml(row[1]) + "</td>" +
            "</tr>"
        );
    }).join("");

    const notice = model.simulated ? SIMULATED_NOTICE : PROJECTION_NOTICE;
    const preheader = "Your " + model.assetName + " investment (" + model.reference + ") is active.";

    return (
        "<!DOCTYPE html>" +
        '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">' +
        "<head>" +
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta name="color-scheme" content="dark light">' +
        '<meta name="supported-color-schemes" content="dark light">' +
        "<title>" + escapeHtml(SUBJECT) + "</title>" +
        "<style>" +
        "@media only screen and (max-width:600px){" +
        ".gv-outer{padding:16px 8px !important;}" +
        ".gv-card{padding:24px 18px !important;}" +
        ".gv-heading{font-size:22px !important;}" +
        ".gv-label{display:block !important;width:100% !important;padding-bottom:2px !important;}" +
        ".gv-value{display:block !important;width:100% !important;text-align:left !important;padding:0 0 12px 0 !important;}" +
        ".gv-button a{display:block !important;}" +
        "}" +
        "</style>" +
        "</head>" +
        '<body style="margin:0;padding:0;background-color:' + c.background + ';color:' + c.text + ';" bgcolor="' + c.background + '">' +
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">' +
        escapeHtml(preheader) + "</div>" +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="' + c.background + '" style="background-color:' + c.background + ';">' +
        '<tr><td class="gv-outer" align="center" style="padding:32px 16px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">' +

        '<tr><td align="left" style="padding:0 4px 20px;">' +
        '<img src="' + escapeHtml(siteUrl) + '/assets/globalvest-logo-emerald.png" alt="GlobalVest" width="168" height="auto" style="display:block;border:0;max-width:168px;height:auto;" />' +
        "</td></tr>" +

        '<tr><td class="gv-card" bgcolor="' + c.card + '" style="background-color:' + c.card + ";border:1px solid " + c.border + ";border-radius:14px;padding:36px 32px;font-family:" + font + ';">' +
        '<p style="margin:0 0 8px;font-size:12px;line-height:1.4;letter-spacing:0.12em;text-transform:uppercase;color:' + c.primary + ';">Investment Confirmation</p>' +
        '<h1 class="gv-heading" style="margin:0 0 20px;font-size:26px;line-height:1.25;font-weight:700;color:' + c.text + ';">Your Investment Has Been Confirmed</h1>' +
        '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:' + c.text + ';">Dear ' + escapeHtml(model.customerName) + ",</p>" +
        '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:' + c.text + ';">Thank you for choosing GlobalVest.</p>' +
        '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:' + c.muted + ';">Your investment has been successfully created and added to your investment portfolio.</p>' +

        '<p style="margin:0 0 4px;font-size:12px;line-height:1.4;letter-spacing:0.1em;text-transform:uppercase;color:' + c.primary + ';">Investment Details</p>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;">' +
        rows +
        "</table>" +

        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr>' +
        '<td style="border-left:3px solid ' + c.primary + ";padding:10px 14px;font-family:" + font + ";font-size:13px;line-height:1.5;color:" + c.muted + ';">' +
        escapeHtml(notice) + "</td></tr></table>" +

        '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>' +
        '<td class="gv-button" align="center" bgcolor="' + c.primary + '" style="background-color:' + c.primary + ';border-radius:10px;">' +
        '<a href="' + escapeHtml(model.viewUrl) + '" style="display:inline-block;padding:15px 32px;font-family:' + font + ";font-size:14px;font-weight:700;letter-spacing:0.06em;color:" + c.buttonText + ';text-decoration:none;">VIEW MY INVESTMENT</a>' +
        "</td></tr></table>" +
        "</td></tr>" +

        '<tr><td style="padding:24px 8px 0;font-family:' + font + ";font-size:12px;line-height:1.6;color:" + c.muted + ';text-align:center;">' +
        '<p style="margin:0 0 6px;color:' + c.text + ';font-size:13px;">Thank you for choosing GlobalVest.</p>' +
        '<p style="margin:0 0 12px;">GlobalVest Investment Services</p>' +
        '<p style="margin:0 0 6px;">This is an automated transactional email.</p>' +
        '<p style="margin:0 0 12px;">If you did not authorize this activity, contact GlobalVest support immediately at ' +
        '<a href="mailto:' + escapeHtml(supportEmail) + '" style="color:' + c.primary + ';text-decoration:underline;">' + escapeHtml(supportEmail) + "</a>.</p>" +
        '<p style="margin:0 0 4px;"><a href="' + escapeHtml(siteUrl) + '" style="color:' + c.muted + ';text-decoration:underline;">' + escapeHtml(siteUrl) + "</a></p>" +
        '<p style="margin:0;color:#6B8A7F;">' + escapeHtml(physicalAddress) + "</p>" +
        "</td></tr>" +

        "</table></td></tr></table></body></html>"
    );
}

function buildInvestmentConfirmationEmail(data) {
    const model = buildDisplayModel(data);
    const supportEmail = getSupportEmail();
    const siteUrl = getSiteUrl();
    const physicalAddress = getPhysicalAddress();
    return {
        subject: SUBJECT,
        text: buildPlainText(model, supportEmail, siteUrl, physicalAddress),
        html: buildHtml(model, supportEmail, siteUrl, physicalAddress),
        model: model,
        brand: BRAND_NAME
    };
}

module.exports = {
    SUBJECT,
    SENDER_DISPLAY_NAME,
    COLORS,
    SIMULATED_NOTICE,
    buildInvestmentConfirmationEmail,
    buildDisplayModel,
    formatUsd,
    formatDate
};
