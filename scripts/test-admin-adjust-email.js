#!/usr/bin/env node
/**
 * Tests server-side admin credit/debit email content + adjustUserBalance with local registry.
 * Run: node scripts/test-admin-adjust-email.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.USE_LOCAL_REGISTRY = "1";
process.env.RESEND_API_KEY = "";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gv-admin-adjust-"));
const dataDir = path.join(tmpRoot, "data");
fs.mkdirSync(dataDir, { recursive: true });

const accountsPath = path.join(dataDir, "accounts.json");
const adminPath = path.join(dataDir, "admin.json");

fs.writeFileSync(accountsPath, JSON.stringify({
    "customer@example.com": {
        cash: 100,
        profile: { fullName: "Test Customer", email: "customer@example.com" },
        transactions: [],
        notifications: [],
        emails: []
    }
}));

fs.writeFileSync(adminPath, JSON.stringify({
    email: "admin@globalvest.com",
    balance: 10000,
    payments: [],
    pendingDeposits: [],
    pendingTransfers: [],
    userActivityLog: [],
    registeredUsers: {
        "customer@example.com": {
            email: "customer@example.com",
            name: "Test Customer"
        }
    },
    websiteSettings: { siteName: "GlobalVest" }
}));

// Point local registry at temp files by monkey-patching after require path setup.
const localRegistryPath = path.join(__dirname, "..", "server-lib", "local-registry.js");
const localRegistry = require(localRegistryPath);
const originalAccounts = localRegistry.ACCOUNTS_PATH;
const originalAdmin = localRegistry.ADMIN_PATH;

// local-registry uses fixed paths under project data/ — write into project data with backup.
const projectAccounts = path.join(__dirname, "..", "data", "accounts.json");
const projectAdmin = path.join(__dirname, "..", "data", "admin.json");
const bakAccounts = projectAccounts + ".bak-test";
const bakAdmin = projectAdmin + ".bak-test";

fs.mkdirSync(path.dirname(projectAccounts), { recursive: true });
if (fs.existsSync(projectAccounts)) fs.copyFileSync(projectAccounts, bakAccounts);
if (fs.existsSync(projectAdmin)) fs.copyFileSync(projectAdmin, bakAdmin);
fs.copyFileSync(accountsPath, projectAccounts);
fs.copyFileSync(adminPath, projectAdmin);

const depositEmails = require(path.join(__dirname, "..", "server-lib", "deposit-emails"));
const { adjustUserBalance } = require(path.join(__dirname, "..", "server-lib", "registry"));

async function run() {
    try {
        const content = depositEmails.buildAdminCreditContent(
            { userEmail: "customer@example.com", amount: 250, note: "Payroll" },
            { cash: 350, profile: { fullName: "Test Customer" } },
            { websiteSettings: { siteName: "GlobalVest" } }
        );
        assert.ok(content.subject.indexOf("Deposit Credited ($250.00)") !== -1);
        assert.ok(content.body.indexOf("Payroll") !== -1);

        const result = await adjustUserBalance("customer@example.com", "credit", 250, "Payroll");
        assert.strictEqual(result.ok, true, "adjust ok");
        assert.strictEqual(result.action, "credit");
        assert.strictEqual(result.amount, 250);
        assert.strictEqual(result.newBalance, 350);
        assert.ok(result.account.emails && result.account.emails.length >= 1, "inbox email queued");
        assert.ok(
            result.account.emails[0].subject.indexOf("Deposit Credited") !== -1,
            "inbox subject"
        );
        assert.ok(
            result.account.notifications.some(function(n) {
                return n.title === "Deposit credited" && n.amount === 250;
            }),
            "notification created"
        );
        // Email send fails without RESEND_API_KEY, but adjust must still succeed.
        assert.strictEqual(result.emailSent, false, "email not sent without Resend");
        assert.ok(result.emailError, "email error reported");

        console.log("admin adjust email tests: passed");
    } finally {
        if (fs.existsSync(bakAccounts)) {
            fs.copyFileSync(bakAccounts, projectAccounts);
            fs.unlinkSync(bakAccounts);
        } else if (fs.existsSync(projectAccounts)) {
            fs.unlinkSync(projectAccounts);
        }
        if (fs.existsSync(bakAdmin)) {
            fs.copyFileSync(bakAdmin, projectAdmin);
            fs.unlinkSync(bakAdmin);
        } else if (fs.existsSync(projectAdmin)) {
            fs.unlinkSync(projectAdmin);
        }
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
}

run().catch(function(err) {
    console.error("admin adjust email tests failed:", err && err.message ? err.message : err);
    process.exit(1);
});
