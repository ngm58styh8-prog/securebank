const assert = require("assert");
const crypto = require("crypto");
const localRegistry = require("../server-lib/local-registry");
const passwordReset = require("../server-lib/password-reset");

process.env.USE_LOCAL_REGISTRY = "1";

const email = "reset-test-" + Date.now() + "@example.com";

async function run() {
    const accounts = localRegistry.loadAllAccounts();
    accounts[email] = {
        password: "oldpass1",
        cash: 0,
        emailVerified: true,
        profile: { fullName: "Reset Tester", email: email },
        holdings: {},
        transactions: [],
        notifications: []
    };
    localRegistry.saveAllAccounts(accounts);

    const requested = await passwordReset.requestPasswordReset("not-an-email");
    assert.strictEqual(requested.ok, false);

    const missing = await passwordReset.requestPasswordReset("nobody-" + crypto.randomBytes(4).toString("hex") + "@example.com");
    assert.strictEqual(missing.ok, true);

    const sent = await passwordReset.requestPasswordReset(email);
    assert.strictEqual(sent.ok, true);
    assert.strictEqual(sent.emailSent, false);
    assert.ok(sent.localCode);
    assert.ok(/^\d{6}$/.test(sent.localCode));

    const stored = localRegistry.loadAllAccounts()[email];
    assert.ok(stored.passwordResetCode);
    assert.strictEqual(stored.passwordResetCode, sent.localCode);

    const badCode = await passwordReset.completePasswordReset(email, "000000", "newpass1");
    assert.strictEqual(badCode.ok, false);

    const shortPw = await passwordReset.completePasswordReset(email, stored.passwordResetCode, "123");
    assert.strictEqual(shortPw.ok, false);

    const done = await passwordReset.completePasswordReset(email, stored.passwordResetCode, "newpass1");
    assert.strictEqual(done.ok, true);

    const updated = localRegistry.loadAllAccounts()[email];
    assert.strictEqual(updated.password, "newpass1");
    assert.ok(!updated.passwordResetCode);
    assert.ok((updated.notifications || []).some(function(n) {
        return String(n.message || "").indexOf("password was reset") !== -1;
    }));

    const reused = await passwordReset.completePasswordReset(email, stored.passwordResetCode, "another1");
    assert.strictEqual(reused.ok, false);
    assert.strictEqual(localRegistry.loadAllAccounts()[email].password, "newpass1");

    const leftover = localRegistry.loadAllAccounts();
    delete leftover[email];
    localRegistry.saveAllAccounts(leftover);

    console.log("password reset tests: 8 passed");
}

run().catch(function(err) {
    try {
        const leftover = localRegistry.loadAllAccounts();
        delete leftover[email];
        localRegistry.saveAllAccounts(leftover);
    } catch (cleanupErr) { /* ignore */ }
    console.error(err);
    process.exit(1);
});
