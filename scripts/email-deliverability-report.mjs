#!/usr/bin/env node
/**
 * Print a full email deliverability report for GlobalVest verification mail.
 * Usage: node scripts/email-deliverability-report.mjs
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

const report = getDeliverabilityReport();

console.log("\n=== GlobalVest Bank — Email Deliverability Report ===\n");
console.log("Generated:", report.generatedAt);
console.log("Inbox ready:", report.inboxReady ? "YES" : "NO");
console.log("\n--- Configured sender ---");
console.log("From:     ", report.configured.from);
console.log("Reply-To: ", report.configured.replyTo);
console.log("Site URL: ", report.configured.siteUrl);

if (report.warnings.length) {
    console.log("\n--- Current issues ---");
    report.warnings.forEach(function(w, i) {
        console.log((i + 1) + ". " + w);
    });
} else {
    console.log("\n--- Current issues ---\nNone detected in environment configuration.");
}

console.log("\n--- Authentication alignment ---");
console.log(JSON.stringify(report.authenticationAlignment, null, 2));

console.log("\n--- DNS (add in domain registrar / Cloudflare) ---");
console.log("Domain:", report.dns.domain);
console.log("SPF host:", report.dns.spf.host);
console.log("SPF note:", report.dns.spf.note);
console.log("DKIM:", report.dns.dkim.note);
console.log("DMARC host:", report.dns.dmarc.host);
console.log("DMARC recommended:", report.dns.dmarc.recommended);

console.log("\n--- Inbox placement recommendations ---");
report.recommendations.forEach(function(r, i) {
    console.log((i + 1) + ". " + r);
});

console.log("\n--- Security ---");
report.security.forEach(function(s, i) {
    console.log((i + 1) + ". " + s);
});

console.log("\nFull JSON: GET /api/verification-health\n");
