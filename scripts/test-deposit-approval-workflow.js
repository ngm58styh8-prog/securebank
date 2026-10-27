#!/usr/bin/env node
/**
 * Deposit verification, approval, balance ledger, and duplicate guards (local registry + stub email).
 * Run: npm run test:deposit-approval
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gv-dep-approval-"));
process.env.GLOBALVEST_DATA_DIR = tmp;
process.env.USE_LOCAL_REGISTRY = "1";
process.env.RESEND_API_KEY = "re_test_key_not_real_0000000000";

class FakeResend {
    constructor() {
        this.emails = {
            send: async function(payload) {
                return { data: { id: "msg_dep_test" }, error: null };
            }
        };
    }
}

const originalLoad = Module._load;
Module._load = function(request) {
    if (request === "resend") return { Resend: FakeResend };
    return originalLoad.apply(this, arguments);
};

const { saveAllAccounts, saveAdminRegistry } = require("../server-lib/local-registry");
const registry = require("../server-lib/registry");
const verification = require("../server-lib/deposit-verification");
const depositEmails = require("../server-lib/deposit-emails");

const REAL_BTC = "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2";
const USER = "depositor@example.com";

let passed = 0;
function ok(name, fn) {
    return Promise.resolve().then(fn).then(function() {
        passed += 1;
        console.log("  PASS  " + name);
    }, function(err) {
        console.error("  FAIL  " + name + "\n        " + (err && err.stack || err));
        process.exitCode = 1;
    });
}

async function seed() {
    await saveAdminRegistry({
        email: "admin@securebank.com",
        password: "admin-test-pass",
        balance: 0,
        payments: [],
        pendingDeposits: [],
        pendingTransfers: [],
        userActivityLog: [],
        cryptoDepositWallets: [
            { symbol: "BTC", name: "Bitcoin", network: "Bitcoin Mainnet", address: REAL_BTC }
        ],
        walletAddress: REAL_BTC
    });
    await saveAllAccounts({
        [USER]: {
            cash: 5000,
            transactions: [],
            pendingDeposits: [],
            depositLedger: [],
            profile: { fullName: "Depositor User" }
        }
    });
}

async function appendDeposit(id) {
    return registry.appendPendingDeposit({
        id: id,
        userEmail: USER,
        userName: "Depositor User",
        amount: 2000,
        currency: "BTC",
        cryptoAmount: 0.02,
        method: "crypto",
        walletAddress: REAL_BTC,
        payTo: REAL_BTC,
        network: "Bitcoin Mainnet",
        status: "pending"
    }, { skipEmail: true });
}

async function run() {
    console.log("deposit approval workflow tests\n");

    await ok("unverified deposit cannot be approved", async function() {
        await seed();
        await appendDeposit("dep-unverified-1");
        let errMsg = "";
        try {
            await registry.approvePendingDeposit("dep-unverified-1", { adminEmail: "admin@securebank.com" });
        } catch (err) {
            errMsg = err.message || String(err);
        }
        assert.ok(errMsg.indexOf("not verified") !== -1, "expected verification error, got: " + errMsg);
    });

    await ok("verified deposit credits balance once", async function() {
        await seed();
        await appendDeposit("dep-verified-1");
        await registry.verifyDepositPayment("dep-verified-1", {
            adminEmail: "admin@securebank.com",
            verificationSource: "verified_on_chain",
            txHash: "abc123txhash"
        });
        const result = await registry.approvePendingDeposit("dep-verified-1", {
            adminEmail: "admin@securebank.com"
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.balanceBefore, 5000);
        assert.strictEqual(result.balanceAfter, 7000);
        const accounts = await registry.loadAllAccounts();
        const acct = accounts[USER];
        assert.strictEqual(acct.cash, 7000);
        assert.ok(Array.isArray(acct.depositLedger) && acct.depositLedger.length === 1);
        assert.strictEqual(acct.depositLedger[0].amount, 2000);
    });

    await ok("duplicate approval does not double credit", async function() {
        await seed();
        await appendDeposit("dep-dup-1");
        await registry.verifyDepositPayment("dep-dup-1", {
            verificationSource: "verified_reconciliation"
        });
        await registry.approvePendingDeposit("dep-dup-1", { adminEmail: "admin@securebank.com" });
        const second = await registry.approvePendingDeposit("dep-dup-1", { adminEmail: "admin@securebank.com" });
        assert.strictEqual(second.alreadyResolved, true);
        const accounts = await registry.loadAllAccounts();
        assert.strictEqual(accounts[USER].cash, 7000);
    });

    await ok("reject requires reason and does not credit", async function() {
        await seed();
        await appendDeposit("dep-reject-1");
        let missingReason = "";
        try {
            await registry.rejectPendingDeposit("dep-reject-1", "  ", { adminEmail: "admin@securebank.com" });
        } catch (err) {
            missingReason = err.message;
        }
        assert.ok(missingReason.indexOf("reason") !== -1);
        await registry.rejectPendingDeposit("dep-reject-1", "Payment not found on chain", {
            adminEmail: "admin@securebank.com"
        });
        const accounts = await registry.loadAllAccounts();
        assert.strictEqual(accounts[USER].cash, 5000);
    });

    await ok("demo wallet address blocked from approval", async function() {
        let msg = "";
        try {
            verification.assertCanApproveDeposit({
                status: "pending",
                paymentVerifiedAt: new Date().toISOString(),
                currency: "BTC",
                walletAddress: "DEMO-BTC-ADDRESS-DO-NOT-SEND-FUNDS"
            });
        } catch (err) {
            msg = err.message || String(err);
        }
        assert.ok(/Demo deposit|Invalid or unsupported/i.test(msg), "unexpected: " + msg);
    });

    await ok("credited email uses premium subject", async function() {
        const content = depositEmails.buildDepositCreditedContent({
            id: "dep-email-1",
            userEmail: USER,
            amount: 2000,
            method: "crypto",
            currency: "BTC",
            walletAddress: REAL_BTC,
            reference: "GV-DEP-TEST",
            resolvedAt: new Date().toISOString()
        }, { cash: 7000, profile: { fullName: "Depositor User" } }, {});
        assert.strictEqual(content.subject, "GlobalVest | Deposit Confirmation");
        assert.ok(content.html && content.html.indexOf("VIEW MY ACCOUNT") !== -1);
    });

    console.log("\n" + passed + " deposit approval checks completed.");
    if (process.exitCode) process.exit(process.exitCode);
}

run();
