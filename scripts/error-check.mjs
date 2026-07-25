#!/usr/bin/env node
/**
 * Run local code and configuration checks.
 * Usage: npm run error-check
 */
import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const { loadProjectEnv, getEnvSetupStatus } = require(path.join(root, "server-lib", "load-env.js"));
const { useLocalRegistry } = require(path.join(root, "server-lib", "registry"));

let failures = 0;

function pass(label) {
    console.log("PASS", label);
}

function fail(label, detail) {
    failures += 1;
    console.error("FAIL", label + (detail ? " — " + detail : ""));
}

function walkJsFiles(dir, files) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) {
            if (name === "node_modules" || name === ".git") continue;
            walkJsFiles(p, files);
        } else if (/\.(js|mjs)$/.test(name)) {
            files.push(p);
        }
    }
}

function checkSyntax() {
    const files = [];
    ["api", "server-lib", "js", "scripts"].forEach(function(dir) {
        walkJsFiles(path.join(root, dir), files);
    });
    let syntaxFails = 0;
    files.forEach(function(file) {
        try {
            execSync("node --check " + JSON.stringify(file), { stdio: "pipe" });
        } catch (e) {
            syntaxFails += 1;
            fail("syntax " + path.relative(root, file), e.stderr?.toString().trim() || e.message);
        }
    });
    if (!syntaxFails) pass("JavaScript syntax (" + files.length + " files)");
}

function checkModules() {
    let moduleFails = 0;
    const apiDir = path.join(root, "api");
    const serverLib = path.join(root, "server-lib");
    fs.readdirSync(apiDir).filter(function(f) { return f.endsWith(".js"); }).forEach(function(f) {
        try {
            require(path.join(apiDir, f));
        } catch (e) {
            moduleFails += 1;
            fail("module api/" + f, e.message);
        }
    });
    fs.readdirSync(serverLib).filter(function(f) { return f.endsWith(".js"); }).forEach(function(f) {
        try {
            require(path.join(serverLib, f));
        } catch (e) {
            moduleFails += 1;
            fail("module server-lib/" + f, e.message);
        }
    });
    try {
        const gold = require(path.join(root, "server-lib", "gold-investments.js"));
        if (gold.MS_CREDIT_INTERVAL !== 180000) fail("gold interval", "expected 180000");
        else if (gold.DEFAULT_DAILY_RETURN !== 1500) fail("gold return", "expected 1500");
    } catch (e) {
        moduleFails += 1;
        fail("gold constants", e.message);
    }
    if (!moduleFails) pass("API and server-lib modules");
}

function checkNotifications() {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "test-notifications.js")], {
        cwd: root,
        encoding: "utf8"
    });
    if (result.status === 0) pass("notification tests");
    else fail("notification tests", (result.stdout || result.stderr || "").trim());
}

function checkGold() {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "test-gold-investments.js")], {
        cwd: root,
        encoding: "utf8"
    });
    if (result.status === 0) pass("gold investment tests");
    else fail("gold investment tests", (result.stdout || result.stderr || "").trim());
}

function checkEnv() {
    loadProjectEnv(root);
    if (useLocalRegistry()) {
        pass("Supabase environment (local registry mode)");
        return true;
    }
    const status = getEnvSetupStatus(root);
    if (status.ready) {
        pass("Supabase environment");
        return true;
    }
    if (!status.envLocalExists) {
        fail("Supabase environment", "missing .env.local — run npm run setup:env");
    } else {
        fail("Supabase environment", "edit .env.local with real Supabase URL and service_role key, or set USE_LOCAL_REGISTRY=1");
    }
    return false;
}

async function checkRegistry() {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "check-registry.js")], {
        cwd: root,
        encoding: "utf8",
        env: process.env
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) pass("registry connectivity");
    else fail("registry connectivity", "see output above");
}

console.log("GlobalVest error check");
console.log("====================");

checkSyntax();
checkModules();
checkNotifications();
checkGold();

const envReady = checkEnv();
if (envReady) {
    await checkRegistry();
} else {
    console.log("\nSkipped registry connectivity (configure .env.local first).");
    console.log("Gold/API credits need Supabase — run: npm run setup:env");
}

console.log("\nSummary");
console.log("-------");
if (failures) {
    console.error(failures + " check(s) failed.");
    process.exit(1);
}
console.log("All checks passed.");
process.exit(0);
