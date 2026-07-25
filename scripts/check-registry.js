#!/usr/bin/env node
/**
 * Diagnose Supabase registry connectivity (run locally with .env.local).
 * Usage: npm run check:registry
 */
const fs = require("fs");
const path = require("path");
const { loadProjectEnv, getEnvSetupStatus } = require(path.join(__dirname, "..", "server-lib", "load-env.js"));

const root = path.join(__dirname, "..");
loadProjectEnv(root);

const {
    getSupabaseEnvChecks,
    getMissingSupabaseEnv,
    getSupabaseUrl
} = require(path.join(root, "server-lib", "supabase-config"));
const {
    isRegistryConfigured,
    loadAllAccounts,
    loadAdminRegistry,
    useLocalRegistry
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
    if (missing.length && !useLocalRegistry()) {
        console.log("\nMissing registry config:");
        missing.forEach(function(item) { console.log("  - " + item); });
        const status = getEnvSetupStatus(root);
        console.log("\nFix:");
        if (!status.envLocalExists) {
            console.log("  npm run setup:env");
        } else {
            console.log("  Edit .env.local with Supabase → Settings → API values");
            console.log("  Or run: npx vercel env pull .env.local");
        }
        console.log("\nFix: Vercel → Project → Settings → Environment Variables");
        process.exit(1);
    }

    if (!isRegistryConfigured()) {
        console.log("\nRegistry is not configured.");
        process.exit(1);
    }

    if (useLocalRegistry()) {
        console.log("Mode: local file registry (data/accounts.json, data/admin.json)");
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
        console.log("  3. Run supabase/migrations/004_gold_investments.sql");
        console.log("  4. Run supabase/migrations/005_gold_credit_interval.sql");
        console.log("  5. Confirm project is not Paused (Dashboard home)");
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

    try {
        const { getSupabaseServiceRoleClient } = require(path.join(root, "server-lib", "supabase"));
        if (useLocalRegistry()) {
            console.log("gold_payouts: skipped (local registry mode)");
        } else {
            const supabase = getSupabaseServiceRoleClient();
            const { error } = await supabase.from("gold_payouts").select("id").limit(1);
            if (error) {
                console.log("gold_payouts: MISSING");
                console.log("  " + (error.message || error));
                console.log("  Run supabase/migrations/004_gold_investments.sql and 005_gold_credit_interval.sql");
            } else {
                console.log("gold_payouts: OK");
            }
        }
    } catch (err) {
        console.log("gold_payouts: check skipped (" + (err.message || err) + ")");
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
