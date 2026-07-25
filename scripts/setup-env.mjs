#!/usr/bin/env node
/**
 * Prepare local environment for registry/API development.
 * Usage: npm run setup:env
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envLocalPath = path.join(root, ".env.local");
const examplePath = path.join(root, ".env.example");
const { getEnvSetupStatus, loadProjectEnv } = require(path.join(root, "server-lib", "load-env.js"));

function printSection(title) {
    console.log("\n" + title);
    console.log("-".repeat(title.length));
}

function main() {
    console.log("GlobalVest environment setup");

    if (!fs.existsSync(examplePath)) {
        console.error("Missing .env.example");
        process.exit(1);
    }

    if (!fs.existsSync(envLocalPath)) {
        fs.copyFileSync(examplePath, envLocalPath);
        console.log("Created .env.local from .env.example");
    } else {
        console.log(".env.local already exists");
    }

    let envText = fs.readFileSync(envLocalPath, "utf8");
    if (envText.indexOf("USE_LOCAL_REGISTRY") === -1) {
        envText = "# Use local JSON files when Supabase is not configured\nUSE_LOCAL_REGISTRY=1\n\n" + envText;
        fs.writeFileSync(envLocalPath, envText);
        console.log("Enabled USE_LOCAL_REGISTRY=1 in .env.local");
    }

    loadProjectEnv(root);
    const status = getEnvSetupStatus(root);
    const localMode = /USE_LOCAL_REGISTRY\s*=\s*1/.test(fs.readFileSync(envLocalPath, "utf8"));

    printSection("Status");
    console.log(".env.local:", status.envLocalExists ? "present" : "missing");
    if (status.loadedFrom.length) {
        console.log("Loaded:", status.loadedFrom.join(", "));
    }
    console.log("SUPABASE_URL:", status.supabaseUrlSet ? "configured" : "NOT configured");
    console.log("SUPABASE_SERVICE_ROLE_KEY:", status.serviceRoleSet ? "configured" : "NOT configured");

    if (status.ready) {
        printSection("Result");
        console.log("Environment looks ready. Run: npm run check:registry");
        process.exit(0);
    }

    if (localMode || String(process.env.USE_LOCAL_REGISTRY || "").trim() === "1") {
        printSection("Result");
        console.log("Local registry mode is enabled (USE_LOCAL_REGISTRY=1).");
        console.log("You can run ./start.sh or npm run dev without Supabase credentials.");
        console.log("Run: npm run error-check");
        process.exit(0);
    }

    printSection("Next steps");
    console.log("1. Open .env.local in the project root");
    console.log("2. Set SUPABASE_URL from Supabase → Project Settings → API");
    console.log("3. Set SUPABASE_SERVICE_ROLE_KEY to the service_role key (NOT anon/publishable)");
    console.log("4. Optional: set RESEND_* values for email tests");
    console.log("");
    console.log("If this project is linked to Vercel, you can pull production env vars:");
    console.log("  npx vercel env pull .env.local");
    console.log("");
    console.log("Then run:");
    console.log("  npm run check:registry");
    console.log("  npm run error-check");
    process.exit(1);
}

main();
