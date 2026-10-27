#!/usr/bin/env node
/**
 * Read-only row counts for preservation verification (no writes, no DELETE).
 * Run: node scripts/db-preservation-check.mjs
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
    if (!url || !key) {
        console.log("db-preservation-check: skipped (Supabase env not set in this shell)");
        process.exit(0);
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const tables = ["user_accounts", "crypto_deposits", "admin_registry", "gold_investments"];
    const counts = {};

    for (const table of tables) {
        const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
        if (error) {
            counts[table] = "error: " + error.message;
        } else {
            counts[table] = count;
        }
    }

    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), counts: counts }, null, 2));
}

main().catch(function(err) {
    console.error(err);
    process.exit(1);
});
