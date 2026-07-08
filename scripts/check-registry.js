#!/usr/bin/env node
/**
 * Diagnose Supabase registry connectivity (run locally with .env.local).
 * Usage: npm run check:registry
 */
const fs = require("fs");
const path = require("path");

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

const root = path.join(__dirname, "..");
loadDotenv(path.join(root, ".env.local"));
loadDotenv(path.join(root, ".env"));

const {
    getSupabaseEnvChecks,
    getMissingSupabaseEnv,
    getSupabaseUrl
} = require(path.join(root, "server-lib", "supabase-config"));
const {
    isRegistryConfigured,
    loadAllAccounts,
    loadAdminRegistry
} = require(path.join(root, "server-lib", "registry"));

function printSection(title) {
    console.log("\n" + title);
    console.log("-".repeat(title.length));
}

async function main() {
    console.log("GlobalVest registry diagnostic");

    printSection("Environment");
    const checks = getSupabaseEnvChecks();
    console.log("SUPABASE_URL set:", checks.SUPABASE_URL.set ? "yes" : "NO");
    if (checks.SUPABASE_URL.set) {
        console.log("SUPABASE_URL value:", getSupabaseUrl());
    }
    console.log(
        "SUPABASE_SERVICE_ROLE_KEY:",
        checks.SUPABASE_SERVICE_ROLE_KEY.set
            ? (checks.SUPABASE_SERVICE_ROLE_KEY.valid ? "valid (" + checks.SUPABASE_SERVICE_ROLE_KEY.type + ")" : "INVALID")
            : "NOT SET"
    );
    if (checks.SUPABASE_SERVICE_ROLE_KEY.error) {
        console.log("Key error:", checks.SUPABASE_SERVICE_ROLE_KEY.error);
    }

    const missing = getMissingSupabaseEnv().filter(function(item) {
        return item.indexOf("RESEND_") === -1;
    });
    if (missing.length) {
        console.log("\nMissing registry config:");
        missing.forEach(function(item) { console.log("  - " + item); });
        console.log("\nFix: Vercel → Project → Settings → Environment Variables");
        process.exit(1);
    }

    if (!isRegistryConfigured()) {
        console.log("\nRegistry is not configured.");
        process.exit(1);
    }

    printSection("Supabase tables");
    try {
        const accounts = await loadAllAccounts();
        console.log("user_accounts: OK (" + Object.keys(accounts).length + " rows)");
    } catch (err) {
        console.log("user_accounts: FAILED");
        console.log("  " + (err.message || err));
        console.log("\nFix:");
        console.log("  1. Open Supabase Dashboard → SQL Editor");
        console.log("  2. Run supabase/migrations/002_app_registry.sql");
        console.log("  3. Confirm project is not Paused (Dashboard home)");
        process.exit(1);
    }

    try {
        const admin = await loadAdminRegistry();
        console.log("admin_registry:", admin ? "OK" : "empty (first admin save will create it)");
    } catch (err) {
        console.log("admin_registry: FAILED");
        console.log("  " + (err.message || err));
        process.exit(1);
    }

    printSection("Result");
    console.log("Registry is healthy. Redeploy Vercel if production still fails.");
}

main().catch(function(err) {
    console.error("\nDiagnostic failed:", err.message || err);
    console.log("\nCommon fixes:");
    console.log("  • SUPABASE_URL = https://YOUR-PROJECT.supabase.co (no trailing path)");
    console.log("  • SUPABASE_SERVICE_ROLE_KEY = service_role JWT from Supabase → Settings → API");
    console.log("  • Run supabase/migrations/002_app_registry.sql in SQL Editor");
    console.log("  • Unpause project in Supabase if on free tier");
    process.exit(1);
});
