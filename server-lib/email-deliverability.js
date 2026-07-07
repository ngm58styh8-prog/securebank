/**
 * Transactional email settings tuned for inbox placement (Resend + custom domain).
 */

const DEFAULT_SITE_URL = "https://globalvestbank.com";
const DEFAULT_SUPPORT_EMAIL = "support@globalvestbank.com";
const DEFAULT_FROM = "GlobalVest Bank <noreply@globalvestbank.com>";

function cleanEnvValue(value) {
    let val = String(value || "").trim();
    if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
    ) {
        val = val.slice(1, -1).trim();
    }
    return val;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseFromAddress(from) {
    const match = String(from || "").match(/^(.+?)\s*<([^>]+)>$/);
    if (match) {
        return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
    }
    const email = String(from || "").trim().toLowerCase();
    return { name: "GlobalVest Bank", email: email };
}

function getSiteUrl() {
    return cleanEnvValue(process.env.RESEND_SITE_URL) || DEFAULT_SITE_URL;
}

function getSupportEmail() {
    return cleanEnvValue(process.env.RESEND_REPLY_TO) || DEFAULT_SUPPORT_EMAIL;
}

function getFromAddress() {
    return cleanEnvValue(process.env.RESEND_FROM_EMAIL) || DEFAULT_FROM;
}

function getReplyTo() {
    return getSupportEmail();
}

function isSandboxFromAddress(from) {
    const parsed = parseFromAddress(from);
    return (
        parsed.email.endsWith("@resend.dev") ||
        parsed.email.endsWith("@resend.com") ||
        parsed.email === "onboarding@resend.dev"
    );
}

function getDeliverabilityWarnings() {
    const warnings = [];
    const from = getFromAddress();
    const parsed = parseFromAddress(from);

    if (isSandboxFromAddress(from)) {
        warnings.push(
            "RESEND_FROM_EMAIL uses a Resend sandbox address (" +
                parsed.email +
                "). Hotmail, Gmail, and Yahoo often mark these as spam. Verify globalvestbank.com in Resend and set RESEND_FROM_EMAIL to GlobalVest Bank <noreply@globalvestbank.com>."
        );
    }

    if (!parsed.email.includes("@")) {
        warnings.push("RESEND_FROM_EMAIL is not a valid email address.");
    } else if (!isSandboxFromAddress(from) && !parsed.email.endsWith("@globalvestbank.com")) {
        warnings.push(
            "Sender domain is " +
                parsed.email.split("@")[1] +
                ". For best inbox placement, send from a verified @globalvestbank.com address in Resend."
        );
    }

    if (!cleanEnvValue(process.env.RESEND_FROM_EMAIL)) {
        warnings.push(
            "RESEND_FROM_EMAIL is not set in environment variables. Using default " +
                DEFAULT_FROM +
                " — ensure this domain is verified in Resend."
        );
    }

    return warnings;
}

function buildVerificationEmailContent(code, recipientEmail) {
    const siteUrl = getSiteUrl();
    const supportEmail = getSupportEmail();
    const safeCode = escapeHtml(code);
    const safeEmail = escapeHtml(recipientEmail);
    const loginUrl = siteUrl.replace(/\/$/, "") + "/login.html";

    const subject = "Your GlobalVest Bank sign-in code";

    const text =
        "GlobalVest Bank\n\n" +
        "Use this one-time code to finish signing in or creating your account:\n\n" +
        code +
        "\n\n" +
        "This code expires in 10 minutes and can only be used once.\n\n" +
        "Sign in: " +
        loginUrl +
        "\n\n" +
        "This message was sent to " +
        recipientEmail +
        ". If you did not request it, you can safely ignore this email.\n\n" +
        "Questions? Contact " +
        supportEmail +
        "\n\n" +
        "— GlobalVest Bank\n" +
        siteUrl;

    const html =
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
        '<html lang="en">' +
        "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<title>GlobalVest Bank sign-in code</title></head>" +
        '<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">' +
        "<tr><td align=\"center\">" +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">' +
        "<tr><td style=\"padding:28px 32px 8px;\">" +
        '<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">GlobalVest Bank</p>' +
        '<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111827;">Your sign-in code</h1>' +
        '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">Enter this one-time code to verify your email and continue to your account.</p>' +
        '<div style="margin:0 0 24px;padding:18px 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">' +
        '<span style="font-size:32px;font-weight:700;letter-spacing:0.35em;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">' +
        safeCode +
        "</span></div>" +
        '<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#6b7280;">This code expires in <strong>10 minutes</strong> and can only be used once.</p>' +
        '<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b7280;">Sent to <strong>' +
        safeEmail +
        "</strong></p>" +
        '<a href="' +
        escapeHtml(loginUrl) +
        '" style="display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Continue to GlobalVest Bank</a>' +
        "</td></tr>" +
        "<tr><td style=\"padding:8px 32px 28px;border-top:1px solid #f3f4f6;\">" +
        '<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9ca3af;">If you did not request this code, you can safely ignore this email. Someone may have entered your address by mistake.</p>' +
        '<p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">Need help? Email <a href="mailto:' +
        escapeHtml(supportEmail) +
        '" style="color:#4b5563;">' +
        escapeHtml(supportEmail) +
        "</a></p>" +
        "</td></tr></table></td></tr></table></body></html>";

    return {
        subject: subject,
        text: text,
        html: html,
        headers: {
            "X-Auto-Response-Suppress": "All",
            "X-Entity-Ref-ID": "gv-verify-" + String(recipientEmail || "").replace(/[^a-z0-9@._-]/gi, "")
        },
        tags: [{ name: "category", value: "email_verification" }]
    };
}

module.exports = {
    DEFAULT_FROM,
    DEFAULT_SITE_URL,
    DEFAULT_SUPPORT_EMAIL,
    getSiteUrl,
    getSupportEmail,
    getFromAddress,
    getReplyTo,
    isSandboxFromAddress,
    getDeliverabilityWarnings,
    buildVerificationEmailContent,
    escapeHtml
};
