#!/usr/bin/env node
/**
 * Link Supabase project (from SUPABASE_URL) and run `supabase db push`.
 *
 * Required in .env.local (not committed):
 *   SUPABASE_URL=https://<project-ref>.supabase.co
 *   SUPABASE_DB_PASSWORD=<database password from Supabase → Settings → Database>
 *
 * Optional: SUPABASE_ACCESS_TOKEN if link prompts for login (supabase login).
 */
import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

function loadEnvFile(name) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) return;
    readFileSync(path, "utf8").split("\n").forEach(function(line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) return;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    });
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const url = String(process.env.SUPABASE_URL || "").trim();
const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
if (!match || match[1] === "your-project") {
    console.error("Set a real SUPABASE_URL in .env.local (e.g. https://abcdefgh.supabase.co).");
    process.exit(1);
}

const projectRef = match[1];
const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
if (!dbPassword) {
    console.error("Set SUPABASE_DB_PASSWORD in .env.local (Supabase → Project Settings → Database).");
    process.exit(1);
}

const linkedRefPath = join(process.cwd(), "supabase", ".temp", "project-ref");
const alreadyLinked = existsSync(linkedRefPath) &&
    readFileSync(linkedRefPath, "utf8").trim() === projectRef;

function run(args) {
    const result = spawnSync("npx", args, {
        stdio: "inherit",
        cwd: process.cwd(),
        env: process.env
    });
    if (result.status !== 0) {
        throw new Error("Command failed: npx " + args.join(" "));
    }
}

try {
    if (!alreadyLinked) {
        console.log("Linking Supabase project:", projectRef);
        run(["supabase", "link", "--project-ref", projectRef, "-p", dbPassword, "--yes"]);
    } else {
        console.log("Already linked to", projectRef);
    }

    console.log("Running supabase db push…");
    run(["supabase", "db", "push", "--yes"]);
    console.log("Supabase migrations applied.");
} catch (err) {
    console.error(err.message || err);
    console.error("\nIf link fails, run: npx supabase login");
    console.error("Then retry: npm run supabase:push");
    process.exit(1);
}
