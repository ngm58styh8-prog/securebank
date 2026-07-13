#!/usr/bin/env node
/**
 * Audit transactional email configuration and optionally send test messages.
 * Usage:
 *   node scripts/test-transactional-email-flow.mjs
 *   node scripts/test-transactional-email-flow.mjs you@example.com
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadDotenv(filePath) {
    if (!fs.existsSync(filePath)) return;
    fs.readFileSync(filePath, "utf8").split("\n").forEach(function(line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const idx = trimmed.indexOf("=");
        if (idx === -1) return;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    });
}

loadDotenv(path.join(root, ".env.local"));
loadDotenv(path.join(root, ".env"));

const require = (await import("module")).createRequire(import.meta.url);
const { getDeliverabilityReport } = require("../server-lib/email-deliverability.js");
const depositEmails = require("../server-lib/deposit-emails.js");
const withdrawalEmails = require("../server-lib/withdrawal-emails.js");
const { sendTransferEmailsSafely } = require("../server-lib/send-money-emails.js");

const report = getDeliverabilityReport();

console.log("\nGlobalVest transactional email audit\n");
console.log("Inbox ready:", report.inboxReady ? "yes" : "no");
console.log("From:", report.configured.from);
console.log("Reply-To:", report.configured.replyTo);
console.log("Site URL:", report.configured.siteUrl);

if (report.warnings.length) {
    console.log("\nWarnings:");
    report.warnings.forEach(function(w) { console.log("  - " + w); });
}

console.log("\nDNS checklist:");
console.log("  SPF host:", report.dns.spf.host);
console.log("  DKIM:", report.dns.dkim.note);
console.log("  DMARC host:", report.dns.dmarc.host);
console.log("  DMARC value:", report.dns.dmarc.recommended);

console.log("\nEmail triggers:");
console.log("  Deposits: server-lib/deposit-emails.js (received, credited, declined)");
console.log("  Withdrawals: server-lib/withdrawal-emails.js (received, processed, declined)");
console.log("  Funds received: server-lib/send-money-emails.js (sender + recipient)");
console.log("  Verification: server-lib/resend.js sendVerificationEmail()");

const testEmail = process.argv[2];
if (!testEmail) {
    console.log("\nOptional live send test:");
    console.log("  node scripts/test-transactional-email-flow.mjs you@example.com\n");
    process.exit(report.inboxReady ? 0 : 1);
}

if (!process.env.RESEND_API_KEY) {
    console.error("\nRESEND_API_KEY is not set — cannot send test emails.\n");
    process.exit(1);
}

const sampleDeposit = {
    id: "dep-flow-test",
    userEmail: testEmail,
    userName: "Test User",
    amount: 100,
    method: "bank",
    status: "pending",
    requestedAt: new Date().toISOString(),
    date: new Date().toLocaleString()
};

const sampleTransfer = {
    id: "tx-flow-test",
    userEmail: testEmail,
    userName: "Test User",
    amount: 50,
    destination: "Test Bank ****0000",
    method: "bank",
    status: "pending",
    requestedAt: new Date().toISOString(),
    date: new Date().toLocaleString()
};

const sampleAccount = {
    cash: 1000,
    profile: { fullName: "Test User" }
};

const sampleAdmin = {
    websiteSettings: { siteName: "GlobalVest Bank" }
};

console.log("\nSending test deposit received email to " + testEmail + "...");
const depositResult = await depositEmails.sendDepositReceivedEmailSafely(
    sampleDeposit,
    sampleAccount,
    sampleAdmin
);
console.log(depositResult.sent ? "  sent" : "  failed", depositResult.error || depositResult.id || "");

console.log("Sending test withdrawal received email...");
const withdrawalResult = await withdrawalEmails.sendWithdrawalReceivedEmailSafely(
    Object.assign({}, sampleTransfer, { id: "tx-flow-test-2" }),
    sampleAccount,
    sampleAdmin
);
console.log(withdrawalResult.sent ? "  sent" : "  failed", withdrawalResult.error || withdrawalResult.id || "");

console.log("Sending test funds received email...");
const fundsResult = await sendTransferEmailsSafely({
    transfer: {
        senderEmail: testEmail,
        recipientEmail: testEmail,
        amount: 25,
        currency: "USD",
        reference: "TEST-REF-001",
        note: "Email flow test"
    },
    senderAccount: sampleAccount,
    recipientAccount: sampleAccount
});
console.log(fundsResult.sent ? "  sent" : "  partial/failed", fundsResult.error || "");

console.log("\nCheck inbox and spam folder. Mark as Not Spam if needed.\n");
