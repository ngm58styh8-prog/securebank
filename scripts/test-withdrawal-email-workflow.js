#!/usr/bin/env node
/**
 * Unit tests for withdrawal email workflow (content, dedup, safe-send behavior).
 * Run: npm run test:withdrawal-emails
 */
const assert = require("assert");
const path = require("path");

const withdrawalEmails = require(path.join(__dirname, "..", "server-lib", "withdrawal-emails"));

const sampleTransfer = {
    id: "tx-test-001",
    userEmail: "customer@example.com",
    userName: "Test Customer",
    amount: 150.25,
    destination: "Chase Bank ****4821",
    method: "bank",
    status: "pending",
    requestedAt: "2026-07-08T03:00:00.000Z",
    date: "Jul 7, 2026, 8:00:00 PM"
};

const sampleAccount = {
    cash: 850.75,
    profile: { fullName: "Test Customer" }
};

const sampleAdmin = {
    websiteSettings: { siteName: "GlobalVest" }
};

function testReceivedContent() {
    const content = withdrawalEmails.buildWithdrawalReceivedContent(
        sampleTransfer,
        sampleAccount,
        sampleAdmin
    );

    assert.ok(content.subject.indexOf("Withdrawal Request Received") !== -1, "received subject");
    assert.ok(content.body.indexOf("Pending admin approval") !== -1, "received status");
    assert.ok(content.body.indexOf(sampleTransfer.destination) !== -1, "received destination");
}

function testProcessedContent() {
    const processedTransfer = Object.assign({}, sampleTransfer, {
        resolvedAt: "2026-07-08T03:15:00.000Z"
    });
    const content = withdrawalEmails.buildWithdrawalProcessedContent(
        processedTransfer,
        sampleAccount,
        sampleAdmin
    );

    assert.ok(content.subject.indexOf("Withdrawal Processed") !== -1, "processed subject");
    assert.ok(content.body.indexOf("Amount withdrawn: $150.25") !== -1, "processed amount");
    assert.ok(content.body.indexOf("Updated cash balance: $850.75") !== -1, "processed balance");
}

function testDeclinedContent() {
    const declinedTransfer = Object.assign({}, sampleTransfer, {
        resolvedAt: "2026-07-08T03:20:00.000Z",
        rejectReason: "Insufficient verification"
    });
    const content = withdrawalEmails.buildWithdrawalDeclinedContent(
        declinedTransfer,
        sampleAccount,
        sampleAdmin,
        "Insufficient verification"
    );

    assert.ok(content.subject.indexOf("Withdrawal Declined") !== -1, "declined subject");
    assert.ok(content.body.indexOf("Reason: Insufficient verification") !== -1, "declined reason");
}

async function testDuplicateSkipped() {
    const sentTransfer = Object.assign({}, sampleTransfer, {
        submittedEmailSentAt: "2026-07-08T03:00:00.000Z"
    });

    const result = await withdrawalEmails.sendWithdrawalReceivedEmailSafely(
        sentTransfer,
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
        const freshTransfer = Object.assign({}, sampleTransfer, { id: "tx-test-fail-001" });
        delete freshTransfer.submittedEmailSentAt;

        const result = await withdrawalEmails.sendWithdrawalReceivedEmailSafely(
            freshTransfer,
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
    testProcessedContent();
    testDeclinedContent();
    await testDuplicateSkipped();
    await testFailureDoesNotThrow();
    console.log("withdrawal email workflow tests: 5 passed");
}

run().catch(function(err) {
    console.error("withdrawal email workflow tests failed:", err.message || err);
    process.exit(1);
});
