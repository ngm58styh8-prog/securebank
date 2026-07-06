#!/usr/bin/env node
/**
 * Verify Resend + Supabase email verification configuration.
 * Usage: node scripts/verify-email-setup.mjs [test-email@example.com]
 *
 * Loads .env.local from project root if present.
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
const { getMissingSupabaseEnv, getSupabaseServiceRoleKey } = require("../api/lib/supabase-config.js");

console.log("\nGlobalVest email verification — configuration check\n");

const missing = getMissingSupabaseEnv();

if (missing.length) {
    console.log("MISSING or invalid configuration:");
    missing.forEach(function(k) { console.log("  - " + k); });
    console.log("\nSet SUPABASE_SERVICE_ROLE_KEY to the service_role JWT from Supabase → Settings → API Keys.\n");
    process.exit(1);
}

const roleKey = getSupabaseServiceRoleKey();
console.log("All required variables are set:");
console.log("  ✓ SUPABASE_URL");
console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY (" + roleKey.source + ")");
console.log("  ✓ RESEND_API_KEY");
console.log("  ✓ RESEND_FROM_EMAIL");

const testEmail = process.argv[2];
if (!testEmail) {
    console.log("\nOptional: pass a test email to send a verification code:");
    console.log("  node scripts/verify-email-setup.mjs you@example.com\n");
    process.exit(0);
}

process.chdir(root);

const { createAndSendVerification, verifyEmailCode } = require("../api/lib/verification.js");

console.log("\nSending test verification to " + testEmail + "...");
const sendResult = await createAndSendVerification(testEmail, { enforceCooldown: false });

if (!sendResult.ok) {
    console.error("Send failed:", sendResult.error || sendResult);
    process.exit(1);
}

console.log("✓ Code saved to Supabase email_verifications");
console.log("✓ Email sent via Resend");
console.log("\nCheck your inbox, then verify with:");
console.log("  node scripts/verify-email-setup.mjs " + testEmail + " <6-digit-code>\n");

if (process.argv[3]) {
    const verifyResult = await verifyEmailCode(testEmail, process.argv[3]);
    if (verifyResult.ok) {
        console.log("✓ Code verified — email_verifications.verified = true\n");
    } else {
        console.error("Verify failed:", verifyResult.error);
        process.exit(1);
    }
}
