#!/usr/bin/env node
/**
 * Unit tests for deposit email workflow (content, dedup, safe-send behavior).
 * Run: npm run test:deposit-emails
 */
const assert = require("assert");
const path = require("path");

const depositEmails = require(path.join(__dirname, "..", "server-lib", "deposit-emails"));

const sampleDeposit = {
    id: "dep-test-001",
    userEmail: "customer@example.com",
    userName: "Test Customer",
    amount: 250.5,
    method: "crypto",
    payTo: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
    status: "pending",
    requestedAt: "2026-07-08T03:00:00.000Z",
    date: "Jul 7, 2026, 8:00:00 PM"
};

const sampleAccount = {
    cash: 1250.75,
    profile: { fullName: "Test Customer" }
};

const sampleAdmin = {
    websiteSettings: { siteName: "GlobalVest" }
};

function testReceivedContent() {
    const content = depositEmails.buildDepositReceivedContent(
        sampleDeposit,
        sampleAccount,
        sampleAdmin
    );

    assert.strictEqual(
        content.subject,
        "GlobalVest — Deposit Request Received ($250.50)",
        "received subject"
    );
    assert.ok(content.body.indexOf("Pending admin approval") !== -1, "received status");
    assert.ok(content.body.indexOf(sampleDeposit.payTo) !== -1, "received payTo");
    assert.ok(content.body.indexOf("Test Customer") !== -1, "received greeting");
}

function testCreditedContent() {
    const creditedDeposit = Object.assign({}, sampleDeposit, {
        resolvedAt: "2026-07-08T03:15:00.000Z"
    });
    const content = depositEmails.buildDepositCreditedContent(
        creditedDeposit,
        sampleAccount,
        sampleAdmin
    );

    assert.strictEqual(
        content.subject,
        "GlobalVest — Deposit Credited ($250.50)",
        "credited subject"
    );
    assert.ok(content.body.indexOf("Amount credited: $250.50") !== -1, "credited amount");
    assert.ok(content.body.indexOf("Updated cash balance: $1250.75") !== -1, "credited balance");
    assert.ok(content.body.indexOf("Date:") !== -1, "credited date");
}

function testDeclinedContent() {
    const declinedDeposit = Object.assign({}, sampleDeposit, {
        resolvedAt: "2026-07-08T03:20:00.000Z",
        rejectReason: "Payment not received"
    });
    const content = depositEmails.buildDepositDeclinedContent(
        declinedDeposit,
        sampleAccount,
        sampleAdmin,
        "Payment not received"
    );

    assert.strictEqual(
        content.subject,
        "GlobalVest — Deposit Declined ($250.50)",
        "declined subject"
    );
    assert.ok(content.body.indexOf("Reason: Payment not received") !== -1, "declined reason");
    assert.ok(content.body.indexOf("Date:") !== -1, "declined date");
}

async function testDuplicateSkipped() {
    const sentDeposit = Object.assign({}, sampleDeposit, {
        submittedEmailSentAt: "2026-07-08T03:00:00.000Z"
    });

    const result = await depositEmails.sendDepositReceivedEmailSafely(
        sentDeposit,
        sampleAccount,
        sampleAdmin
    );

    assert.strictEqual(result.sent, false, "duplicate should not send");
    assert.strictEqual(result.duplicate, true, "duplicate flag");
}

async function testFailureDoesNotThrow() {
    const resendPath = path.join(__dirname, "..", "server-lib", "resend.js");
    const originalResend = require(resendPath);

    require.cache[resendPath].exports = Object.assign({}, originalResend, {
        sendTransactionalEmail: async function() {
            throw new Error("Resend is not configured. Set RESEND_API_KEY.");
        }
    });

    try {
        const freshDeposit = Object.assign({}, sampleDeposit, { id: "dep-test-fail-001" });
        delete freshDeposit.submittedEmailSentAt;

        const result = await depositEmails.sendDepositReceivedEmailSafely(
            freshDeposit,
            sampleAccount,
            sampleAdmin
        );

        assert.strictEqual(result.sent, false, "failed send returns sent:false");
        assert.ok(result.error, "failed send includes error");
    } finally {
        require.cache[resendPath].exports = originalResend;
    }
}

async function run() {
    testReceivedContent();
    testCreditedContent();
    testDeclinedContent();
    await testDuplicateSkipped();
    await testFailureDoesNotThrow();
    console.log("deposit email workflow tests: 5 passed");
}

run().catch(function(err) {
    console.error("deposit email workflow tests failed:", err.message || err);
    process.exit(1);
});
