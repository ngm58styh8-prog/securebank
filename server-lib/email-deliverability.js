/**
 * Transactional email deliverability for Resend (verification codes).
 * Shared constants live in email-config.json.
 */

const crypto = require("crypto");
const emailConfig = require("./email-config.json");

const DEFAULT_SITE_URL = emailConfig.siteUrl;
const DEFAULT_SUPPORT_EMAIL = emailConfig.replyToEmail;
const DEFAULT_FROM = emailConfig.fromDisplayName + " <" + emailConfig.fromEmail + ">";
const DEFAULT_PHYSICAL_ADDRESS = emailConfig.physicalAddress;
const BRAND_NAME = emailConfig.brandName;

const BLOCKED_SITE_HOSTS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    ".vercel.app",
    ".local"
];

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
    return { name: emailConfig.fromDisplayName, email: email };
}

function extractEmailAddress(value) {
    const parsed = parseFromAddress(value);
    return parsed.email;
}

function isBlockedSiteHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return BLOCKED_SITE_HOSTS.some(function(blocked) {
        if (blocked.startsWith(".")) {
            return host.endsWith(blocked) || host === blocked.slice(1);
        }
        return host === blocked;
    });
}

function normalizeSiteUrl(rawUrl) {
    const fallback = cleanEnvValue(process.env.RESEND_SITE_URL) || DEFAULT_SITE_URL;
    let candidate = cleanEnvValue(rawUrl) || fallback;

    if (!/^https:\/\//i.test(candidate)) {
        candidate = DEFAULT_SITE_URL;
    }

    try {
        const parsed = new URL(candidate);
        if (isBlockedSiteHost(parsed.hostname)) {
            return DEFAULT_SITE_URL.replace(/\/$/, "");
        }
        return (parsed.origin + parsed.pathname).replace(/\/$/, "") || DEFAULT_SITE_URL.replace(/\/$/, "");
    } catch (e) {
        return DEFAULT_SITE_URL.replace(/\/$/, "");
    }
}

function getSiteUrl() {
    return normalizeSiteUrl(process.env.RESEND_SITE_URL);
}

function getSupportEmail() {
    return cleanEnvValue(process.env.RESEND_REPLY_TO) || DEFAULT_SUPPORT_EMAIL;
}

function getPhysicalAddress() {
    return cleanEnvValue(process.env.RESEND_PHYSICAL_ADDRESS) || DEFAULT_PHYSICAL_ADDRESS;
}

function normalizeFromAddress(rawFrom) {
    const from = cleanEnvValue(rawFrom) || DEFAULT_FROM;
    const parsed = parseFromAddress(from);
    const expectedEmail = emailConfig.fromEmail.toLowerCase();

    if (parsed.email === expectedEmail) {
        return emailConfig.fromDisplayName + " <" + expectedEmail + ">";
    }

    return from;
}

function getFromAddress() {
    return normalizeFromAddress(process.env.RESEND_FROM_EMAIL);
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

function getSenderDomain(from) {
    const email = extractEmailAddress(from);
    const parts = email.split("@");
    return parts.length === 2 ? parts[1] : "";
}

function buildMessageId(recipientEmail) {
    const stamp = Date.now().toString(36);
    const hash = crypto
        .createHash("sha256")
        .update(String(recipientEmail || "") + stamp + crypto.randomBytes(8).toString("hex"))
        .digest("hex")
        .slice(0, 16);
    return "<gv-verify-" + stamp + "-" + hash + "@" + emailConfig.fromEmail.split("@")[1] + ">";
}

function buildTransactionalHeaders(recipientEmail, referenceId) {
    const headers = {
        Organization: emailConfig.organizationHeader,
        "X-Auto-Response-Suppress": "All",
        "X-Entity-Ref-ID": referenceId,
        "X-Priority": "3",
        "Message-ID": buildMessageId(recipientEmail)
    };

    return headers;
}

function getDnsRecommendations() {
    const domain = emailConfig.fromEmail.split("@")[1];

    return {
        domain: domain,
        requiredInResendDashboard: [
            "Add and verify " + domain + " at https://resend.com/domains",
            "Click Verify DNS Records after adding SPF and DKIM records"
        ],
        spf: {
            type: "TXT",
            host: domain,
            purpose: "Authorizes Resend to send mail for your domain (exact value shown in Resend Domains → Records tab).",
            example: "v=spf1 include:amazonses.com ~all",
            note: "Copy the SPF TXT record from Resend — do not guess the value."
        },
        dkim: {
            type: "CNAME or TXT",
            host: "resend._domainkey." + domain + " (exact host shown in Resend dashboard)",
            purpose: "Cryptographic signature so Gmail/Outlook trust messages from noreply@" + domain + ".",
            note: "Resend provides 1024-bit DKIM keys. Add every DKIM record Resend lists until status is Verified."
        },
        dmarc: {
            type: "TXT",
            host: "_dmarc." + domain,
            purpose: "Policy for SPF/DKIM alignment failures; required for Gmail/Yahoo bulk senders and improves trust.",
            recommended: "v=DMARC1; p=none; rua=mailto:dmarc@" + domain + "; fo=1",
            strictLater: "After 2–4 weeks of clean sending, move to p=quarantine then p=reject."
        },
        alignment: {
            spf: "Envelope/from domain should match " + domain + " (Resend handles return-path on send subdomain).",
            dkim: "DKIM d= should be " + domain + " when domain is verified in Resend.",
            dmarc: "From: header domain (" + domain + ") should align with DKIM signing domain."
        },
        optional: [
            {
                type: "TXT",
                host: domain,
                name: "BIMI (optional)",
                note: "Brand indicator — only after DMARC p=quarantine or reject with stable reputation."
            }
        ]
    };
}

function getDeliverabilityWarnings() {
    const warnings = [];
    const from = getFromAddress();
    const parsed = parseFromAddress(from);
    const replyTo = getReplyTo();
    const siteUrl = getSiteUrl();
    const envFrom = cleanEnvValue(process.env.RESEND_FROM_EMAIL);

    if (isSandboxFromAddress(from)) {
        warnings.push(
            "RESEND_FROM_EMAIL uses a Resend sandbox address (" +
                parsed.email +
                "). Gmail and Outlook often filter these to Spam. Verify " +
                getSenderDomain(DEFAULT_FROM) +
                " in Resend and set RESEND_FROM_EMAIL=" +
                DEFAULT_FROM +
                "."
        );
    }

    if (!parsed.email.includes("@")) {
        warnings.push("RESEND_FROM_EMAIL is not a valid email address.");
    } else if (!isSandboxFromAddress(from)) {
        const fromDomain = getSenderDomain(from);
        const expectedDomain = emailConfig.fromEmail.split("@")[1];

        if (fromDomain !== expectedDomain) {
            warnings.push(
                "Sender domain is " +
                    fromDomain +
                    ". Use @" +
                    expectedDomain +
                    " (verified in Resend) for SPF/DKIM/DMARC alignment."
            );
        }

        if (parsed.email === emailConfig.replyToEmail) {
            warnings.push(
                "RESEND_FROM_EMAIL is set to support@" +
                    expectedDomain +
                    ". Use From: " +
                    DEFAULT_FROM +
                    " and Reply-To: " +
                    emailConfig.replyToEmail +
                    " so support inbox is not used for outbound mail."
            );
        } else if (parsed.email !== emailConfig.fromEmail) {
            warnings.push(
                "RESEND_FROM_EMAIL is " +
                    parsed.email +
                    ". Recommended: " +
                    emailConfig.fromEmail +
                    " for transactional verification mail."
            );
        }
    }

    if (!cleanEnvValue(process.env.RESEND_FROM_EMAIL)) {
        warnings.push(
            "RESEND_FROM_EMAIL is not set. Set it to " + DEFAULT_FROM + " in Vercel after domain verification."
        );
    } else if (envFrom && !envFrom.includes("<")) {
        warnings.push(
            "RESEND_FROM_EMAIL should include a display name: GlobalVest Bank <" +
                extractEmailAddress(envFrom) +
                ">."
        );
    }

    if (!cleanEnvValue(process.env.RESEND_REPLY_TO)) {
        warnings.push(
            "RESEND_REPLY_TO is not set. Set it to " +
                emailConfig.replyToEmail +
                " so users can reply to support instead of noreply."
        );
    } else if (getSenderDomain(replyTo) !== emailConfig.fromEmail.split("@")[1]) {
        warnings.push("RESEND_REPLY_TO should use the same domain as the From address for brand consistency.");
    }

    if (siteUrl !== DEFAULT_SITE_URL && cleanEnvValue(process.env.RESEND_SITE_URL)) {
        try {
            const parsedSite = new URL(siteUrl);
            if (isBlockedSiteHost(parsedSite.hostname)) {
                warnings.push(
                    "RESEND_SITE_URL points to " +
                        parsedSite.hostname +
                        ". Production emails must link to " +
                        DEFAULT_SITE_URL +
                        "."
                );
            }
        } catch (e) {
            warnings.push("RESEND_SITE_URL is invalid. Use " + DEFAULT_SITE_URL + ".");
        }
    }

    return warnings;
}

function getAuthenticationAlignment() {
    const from = getFromAddress();
    const parsed = parseFromAddress(from);
    const expectedDomain = emailConfig.fromEmail.split("@")[1];
    const fromDomain = getSenderDomain(from);
    const replyDomain = getSenderDomain(getReplyTo());

    return {
        fromHeader: parsed.email,
        fromDomain: fromDomain,
        replyTo: getReplyTo(),
        replyDomain: replyDomain,
        dkimExpectedDomain: expectedDomain,
        spfAligned: fromDomain === expectedDomain && !isSandboxFromAddress(from),
        dkimAligned: fromDomain === expectedDomain && !isSandboxFromAddress(from),
        dmarcReady: fromDomain === expectedDomain && !isSandboxFromAddress(from),
        fromUsesRecommendedAddress: parsed.email === emailConfig.fromEmail,
        replyUsesRecommendedAddress: getReplyTo().toLowerCase() === emailConfig.replyToEmail,
        listUnsubscribeApplicable: false,
        listUnsubscribeReason:
            "Not used for one-time security codes — List-Unsubscribe is for marketing/bulk mail (RFC 8058), not account verification OTP."
    };
}

function getDeliverabilityReport() {
    const warnings = getDeliverabilityWarnings();
    const alignment = getAuthenticationAlignment();

    return {
        generatedAt: new Date().toISOString(),
        brand: BRAND_NAME,
        configured: {
            from: getFromAddress(),
            replyTo: getReplyTo(),
            siteUrl: getSiteUrl(),
            physicalAddress: getPhysicalAddress(),
            env: {
                RESEND_API_KEY: !!cleanEnvValue(process.env.RESEND_API_KEY),
                RESEND_FROM_EMAIL: cleanEnvValue(process.env.RESEND_FROM_EMAIL) || null,
                RESEND_REPLY_TO: cleanEnvValue(process.env.RESEND_REPLY_TO) || null,
                RESEND_SITE_URL: cleanEnvValue(process.env.RESEND_SITE_URL) || null,
                RESEND_PHYSICAL_ADDRESS: cleanEnvValue(process.env.RESEND_PHYSICAL_ADDRESS) || null
            }
        },
        inboxReady: warnings.length === 0,
        warnings: warnings,
        authenticationAlignment: alignment,
        dns: getDnsRecommendations(),
        recommendations: [
            "Set RESEND_FROM_EMAIL=GlobalVest Bank <noreply@globalvestbank.com>",
            "Set RESEND_REPLY_TO=support@globalvestbank.com",
            "Set RESEND_SITE_URL=https://globalvestbank.com",
            "Verify globalvestbank.com in Resend with SPF + DKIM, then add DMARC TXT at _dmarc.globalvestbank.com",
            "Ask test users to mark the first message as Not Spam to train mailbox filters",
            "Keep verification volume steady — sudden spikes hurt new-domain reputation"
        ],
        security: [
            "Codes expire in 10 minutes and are stored hashed in Supabase email_verifications",
            "RESEND_API_KEY is server-only (Vercel env, never exposed to browser)",
            "Message-ID uses your domain for alignment; no tracking pixels in verification mail"
        ]
    };
}

function buildVerificationEmailContent(code, recipientEmail) {
    const siteUrl = getSiteUrl();
    const supportEmail = getSupportEmail();
    const physicalAddress = getPhysicalAddress();
    const safeCode = escapeHtml(code);
    const safeEmail = escapeHtml(recipientEmail);
    const safeSiteUrl = escapeHtml(siteUrl);
    const safeSupport = escapeHtml(supportEmail);
    const safeAddress = escapeHtml(physicalAddress);
    const loginUrl = siteUrl + "/login.html";
    const safeLoginUrl = escapeHtml(loginUrl);
    const referenceId = "gv-verify-" + String(recipientEmail || "").replace(/[^a-z0-9@._-]/gi, "");

    const subject = "Your GlobalVest Bank sign-in code";

    const text =
        BRAND_NAME + "\n\n" +
        "You requested a sign-in code for your account.\n\n" +
        "Your code: " + code + "\n\n" +
        "This code expires in 10 minutes and works once.\n\n" +
        "Continue at: " + loginUrl + "\n\n" +
        "Sent to: " + recipientEmail + "\n" +
        "If you did not request this, ignore this email.\n\n" +
        "Support: " + supportEmail + "\n" +
        "Website: " + siteUrl + "\n\n" +
        physicalAddress + "\n\n" +
        "— " + BRAND_NAME;

    const html =
        "<!DOCTYPE html>" +
        '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">' +
        "<head>" +
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta name="color-scheme" content="light">' +
        '<meta name="supported-color-schemes" content="light">' +
        "<title>" + escapeHtml(subject) + "</title>" +
        "</head>" +
        '<body style="margin:0;padding:0;background-color:#f4f6f8;color:#1f2937;">' +
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' +
        "Your sign-in code for " + BRAND_NAME + " expires in 10 minutes." +
        "</div>" +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f8;">' +
        "<tr><td align=\"center\" style=\"padding:32px 16px;\">" +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">' +
        "<tr><td style=\"padding:32px 32px 16px;\">" +
        "<header>" +
        '<p style="margin:0 0 4px;font-size:12px;line-height:1.4;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">' +
        escapeHtml(BRAND_NAME) +
        "</p>" +
        '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;color:#111827;">Your sign-in code</h1>' +
        "</header>" +
        "<main>" +
        '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">' +
        "Enter this code on the sign-in page to verify your email address." +
        "</p>" +
        '<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7280;">One-time code</p>' +
        '<p style="margin:0 0 24px;padding:16px 20px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;text-align:center;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:0.28em;font-family:Consolas,Monaco,\'Courier New\',monospace;color:#111827;">' +
        safeCode +
        "</p>" +
        '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#6b7280;">' +
        "Expires in 10 minutes. Sent to <strong style=\"color:#374151;\">" + safeEmail + "</strong>." +
        "</p>" +
        '<p style="margin:0 0 24px;">' +
        '<a href="' + safeLoginUrl + '" style="color:#ffffff;background-color:#1f2937;text-decoration:none;display:inline-block;padding:12px 18px;border-radius:6px;font-size:14px;font-weight:600;">Open GlobalVest Bank</a>' +
        "</p>" +
        "</main>" +
        "<footer>" +
        '<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#6b7280;">' +
        "Did not request this? You can ignore this message." +
        "</p>" +
        '<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">' +
        'Support: <a href="mailto:' + safeSupport + '" style="color:#374151;text-decoration:underline;">' + safeSupport + "</a>" +
        "</p>" +
        '<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">' +
        'Website: <a href="' + safeSiteUrl + '" style="color:#374151;text-decoration:underline;">' + safeSiteUrl + "</a>" +
        "</p>" +
        '<p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">' +
        safeAddress +
        "</p>" +
        "</footer>" +
        "</td></tr></table></td></tr></table></body></html>";

    return {
        subject: subject,
        text: text,
        html: html,
        headers: buildTransactionalHeaders(recipientEmail, referenceId),
        tags: [
            { name: "category", value: "email_verification" },
            { name: "environment", value: "production" }
        ]
    };
}

function buildTransactionalEmailContent(subject, textBody, recipientEmail, options) {
    options = options || {};
    const siteUrl = getSiteUrl();
    const supportEmail = getSupportEmail();
    const physicalAddress = getPhysicalAddress();
    const safeSubject = escapeHtml(subject);
    const safeEmail = escapeHtml(recipientEmail);
    const safeSiteUrl = escapeHtml(siteUrl);
    const safeSupport = escapeHtml(supportEmail);
    const safeAddress = escapeHtml(physicalAddress);
    const loginUrl = siteUrl + "/login.html";
    const safeLoginUrl = escapeHtml(loginUrl);
    const category = options.category || "transactional";
    const referenceId = options.referenceId || ("gv-" + category + "-" + Date.now());
    const headline = options.headline || subject;
    const safeHeadline = escapeHtml(headline);

    const paragraphs = String(textBody || "")
        .split(/\n\n+/)
        .map(function(block) {
            return block.trim();
        })
        .filter(Boolean)
        .map(function(block) {
            const lines = block.split("\n").map(escapeHtml).join("<br>");
            return '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">' + lines + "</p>";
        })
        .join("");

    const text = String(textBody || "").trim();

    const html =
        "<!DOCTYPE html>" +
        '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">' +
        "<head>" +
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        "<title>" + safeSubject + "</title>" +
        "</head>" +
        '<body style="margin:0;padding:0;background-color:#f4f6f8;color:#1f2937;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f8;">' +
        "<tr><td align=\"center\" style=\"padding:32px 16px;\">" +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">' +
        "<tr><td style=\"padding:32px 32px 16px;\">" +
        '<p style="margin:0 0 4px;font-size:12px;line-height:1.4;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">' +
        escapeHtml(BRAND_NAME) +
        "</p>" +
        '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;color:#111827;">' +
        safeHeadline +
        "</h1>" +
        paragraphs +
        '<p style="margin:0 0 24px;">' +
        '<a href="' + safeLoginUrl + '" style="color:#ffffff;background-color:#1f2937;text-decoration:none;display:inline-block;padding:12px 18px;border-radius:6px;font-size:14px;font-weight:600;">View your account</a>' +
        "</p>" +
        '<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Sent to <strong style="color:#374151;">' + safeEmail + "</strong></p>" +
        '<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Support: <a href="mailto:' + safeSupport + '" style="color:#374151;text-decoration:underline;">' + safeSupport + "</a></p>" +
        '<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Website: <a href="' + safeSiteUrl + '" style="color:#374151;text-decoration:underline;">' + safeSiteUrl + "</a></p>" +
        '<p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">' + safeAddress + "</p>" +
        "</td></tr></table></td></tr></table></body></html>";

    return {
        subject: subject,
        text: text,
        html: html,
        headers: buildTransactionalHeaders(recipientEmail, referenceId),
        tags: [
            { name: "category", value: category },
            { name: "environment", value: "production" }
        ]
    };
}

module.exports = {
    BRAND_NAME,
    DEFAULT_FROM,
    DEFAULT_SITE_URL,
    DEFAULT_SUPPORT_EMAIL,
    DEFAULT_PHYSICAL_ADDRESS,
    getSiteUrl,
    getSupportEmail,
    getPhysicalAddress,
    getFromAddress,
    getReplyTo,
    isSandboxFromAddress,
    getDeliverabilityWarnings,
    getDnsRecommendations,
    getAuthenticationAlignment,
    getDeliverabilityReport,
    buildVerificationEmailContent,
    buildTransactionalEmailContent,
    buildTransactionalHeaders,
    escapeHtml
};
