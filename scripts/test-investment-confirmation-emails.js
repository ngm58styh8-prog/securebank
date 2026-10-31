#!/usr/bin/env node
/**
 * End-to-end test of the investment confirmation email pipeline.
 *
 * Runs against the local JSON registry in a temporary data directory with a stubbed Resend client,
 * so no real email is sent and no production data is touched. It proves application behaviour
 * (queueing, idempotency, retries, webhooks, admin API). It does NOT prove inbox delivery:
 * that needs real provider delivery events (see README, "Verifying real delivery").
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gv-invemail-"));
process.env.GLOBALVEST_DATA_DIR = tmp;
process.env.USE_LOCAL_REGISTRY = "1";
process.env.RESEND_API_KEY = "re_test_key_not_real_0000000000";
process.env.RESEND_FROM_EMAIL = "GlobalVest Bank <noreply@globalvestbank.com>";
process.env.INVESTMENT_EMAIL_ADMIN_ALERT_TO = "ops@globalvestbank.com";
process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("test-webhook-secret-123456").toString("base64");
delete process.env.INVESTMENT_EMAIL_FROM;

const sent = [];
let failureMode = null;
let sendCounter = 0;

class FakeResend {
    constructor() {
        this.emails = {
            send: async function(payload, options) {
                const isAdminAlert = (payload.tags || []).some(function(t) { return t.value === "admin_alert"; });
                if (failureMode === "temporary" && !isAdminAlert) {
                    return { data: null, error: { name: "application_error", message: "Provider temporarily unavailable", statusCode: 500 } };
                }
                if (failureMode === "permanent" && !isAdminAlert) {
                    return { data: null, error: { name: "validation_error", message: "Domain is not verified", statusCode: 403 } };
                }
                sendCounter += 1;
                const id = "msg_test_" + sendCounter;
                sent.push({ id: id, payload: payload, options: options || {} });
                return { data: { id: id }, error: null };
            }
        };
    }
}

const originalLoad = Module._load;
Module._load = function(request) {
    if (request === "resend") return { Resend: FakeResend };
    return originalLoad.apply(this, arguments);
};

const { saveAllAccounts } = require("../server-lib/local-registry");
const registry = require("../server-lib/registry");
const { enrollInGoldPlan } = require("../server-lib/gold-investments");
const { enrollInSimulationPlan } = require("../server-lib/simulation-investments");
const emails = require("../server-lib/investment-confirmation-emails");
const template = require("../server-lib/investment-confirmation-template");
const adminApi = require("../api/investment-emails");
const webhookApi = require("../api/resend-webhook");

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

function mockRes() {
    const res = { statusCode: 200, headers: {}, body: null };
    res.setHeader = function(k, v) { res.headers[k] = v; };
    res.status = function(code) { res.statusCode = code; return res; };
    res.json = function(body) { res.body = body; return res; };
    res.end = function() { return res; };
    return res;
}

function signWebhook(body, secret, id, timestamp) {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const sig = crypto.createHmac("sha256", key).update(id + "." + timestamp + "." + body).digest("base64");
    return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": "v1," + sig };
}

async function postWebhook(event, overrideHeaders) {
    const body = JSON.stringify(event);
    const id = "msg_" + crypto.randomBytes(4).toString("hex");
    const ts = Math.floor(Date.now() / 1000);
    const headers = overrideHeaders || signWebhook(body, process.env.RESEND_WEBHOOK_SECRET, id, ts);
    const req = { method: "POST", headers: headers, body: body };
    const res = mockRes();
    await webhookApi(req, res);
    return res;
}

function account(email, name, overrides) {
    return Object.assign({
        profile: { fullName: name },
        emailVerified: true,
        cash: 50000,
        transactions: [],
        notifications: []
    }, overrides || {});
}

async function main() {
    const admin = registry.ensureAdminRegistryShape({ email: "admin@globalvest.com", password: "admin123" });
    await registry.saveAdminRegistry(admin);
    saveAllAccounts({
        "ada@example.com": account("ada@example.com", "Ada Lovelace"),
        "grace@example.com": account("grace@example.com", "Grace Hopper"),
        "linus@example.com": account("linus@example.com", "Linus Torvalds", { emailVerified: false })
    });

    console.log("Investment confirmation emails");

    let goldInvestmentId;
    let goldReference;

    await ok("gold purchase commits, then sends exactly one confirmation to the customer", async function() {
        const before = sent.length;
        const result = await enrollInGoldPlan("ada@example.com", "gold-plan-default", 2000);
        assert.ok(result.ok);
        goldInvestmentId = result.goldInvestment.investmentId;
        goldReference = result.goldInvestment.reference;
        assert.match(goldReference, /^GV-INV-\d{8}-[0-9A-F]{8}$/);
        assert.strictEqual(sent.length, before + 1);
        const mail = sent[sent.length - 1];
        assert.deepStrictEqual(mail.payload.to, "ada@example.com");
        assert.strictEqual(mail.payload.from, "GlobalVest Investments <investments@globalvestbank.com>");
        assert.strictEqual(mail.payload.subject, "GlobalVest | Investment Confirmation");
        assert.ok(mail.payload.replyTo.indexOf("@globalvestbank.com") > 0);
        assert.ok(mail.options.idempotencyKey.indexOf(goldInvestmentId + ":investment_confirmation") === 0);
        assert.ok(mail.payload.tags.some(function(t) { return t.name === "notification_id"; }));
    });

    await ok("email content: asset, reference, amount, plan, duration, projections, link, simulated notice", async function() {
        const html = sent[sent.length - 1].payload.html;
        const text = sent[sent.length - 1].payload.text;
        [html, text].forEach(function(body) {
            assert.ok(body.indexOf("Ada Lovelace") !== -1);
            assert.ok(body.indexOf("Gold") !== -1);
            assert.ok(body.indexOf(goldReference) !== -1);
            assert.ok(body.indexOf("$2,000.00") !== -1);
            assert.ok(body.indexOf("GlobalVest Gold Elite") !== -1);
            assert.ok(body.indexOf("365 Days") !== -1, "duration comes from the plan");
            assert.ok(body.indexOf("$62.50") !== -1, "hourly = 1500 / 24");
            assert.ok(body.indexOf("$547,500.00") !== -1, "total = 1500 x 365");
            assert.ok(body.indexOf("$549,500.00") !== -1, "value = principal + earnings");
            assert.ok(/not guaranteed/i.test(body));
            assert.ok(body.indexOf("https://globalvestbank.com/investments?investment=" + goldInvestmentId) !== -1);
        });
        ["#020B09", "#00E89B", "#071A15", "#FFFFFF", "VIEW MY INVESTMENT", "Your Investment Has Been Confirmed",
            "If you did not authorize this activity", "This is an automated transactional email.",
            "@media only screen and (max-width:600px)", 'name="viewport"'].forEach(function(needle) {
            assert.ok(html.indexOf(needle) !== -1, "html missing " + needle);
        });
        assert.ok(!/<script/i.test(html));
        assert.ok(text.length > 200);
    });

    await ok("in-app notification: Investment Confirmed with link to the investment", async function() {
        const acct = (await registry.loadAllAccounts())["ada@example.com"];
        const note = acct.notifications.find(function(n) { return n.title === "Investment Confirmed"; });
        assert.ok(note, "notification exists");
        assert.strictEqual(note.message, "Your Gold investment has been successfully created.");
        assert.ok(
            note.href.indexOf("/gold-investment") !== -1
            || note.href.indexOf("/investments?investment=") !== -1
            || note.href.indexOf("investments?investment=") !== -1
        );
        assert.strictEqual(acct.goldInvestment.reference, goldReference);
    });

    await ok("delivery status recorded as Sent with provider id", async function() {
        const list = await emails.listInvestmentEmails({});
        const row = list.notifications.find(function(n) { return n.investmentId === goldInvestmentId; });
        assert.strictEqual(row.status, "sent");
        assert.ok(row.providerMessageId);
        assert.ok(row.sentAt);
        assert.strictEqual(row.customerEmail, "ada@example.com");
        assert.strictEqual(row.reference, goldReference);
    });

    await ok("duplicate confirmation prevented (investment_id + notification_type)", async function() {
        const before = sent.length;
        const again = await emails.enqueueInvestmentConfirmation({
            investmentId: goldInvestmentId,
            reference: goldReference,
            email: "ada@example.com",
            customerName: "Ada Lovelace",
            assetName: "Gold",
            planName: "GlobalVest Gold Elite",
            amount: 2000,
            durationDays: 365,
            dailyReturn: 1500
        });
        assert.ok(again.duplicate);
        assert.strictEqual(sent.length, before);
        await emails.processDueNotifications({});
        assert.strictEqual(sent.length, before, "queue run must not re-send a sent email");
    });

    let simPositionId;
    await ok("market asset purchase: simulated labelling and plan-based projections", async function() {
        const before = sent.length;
        const result = await enrollInSimulationPlan("grace@example.com", "sim-plan-btc-default", 1000);
        assert.ok(result.ok);
        simPositionId = result.position.id;
        assert.match(result.position.reference, /^GV-INV-/);
        assert.strictEqual(sent.length, before + 1);
        const mail = sent[sent.length - 1].payload;
        assert.strictEqual(mail.to, "grace@example.com");
        assert.ok(mail.html.indexOf("Bitcoin") !== -1);
        assert.ok(mail.html.indexOf("$1,000.00") !== -1);
        assert.ok(mail.html.indexOf("365 Days") !== -1);
        assert.ok(mail.html.indexOf("$0.4167") !== -1, "1% of $1000 = $10/day = $0.4167/h");
        assert.ok(mail.html.indexOf("$3,650.00") !== -1);
        assert.ok(mail.html.indexOf("$4,650.00") !== -1);
        assert.ok(mail.text.indexOf("simulated investment") !== -1);
        assert.ok(mail.html.indexOf("(Simulated)") !== -1);
        const acct = (await registry.loadAllAccounts())["grace@example.com"];
        assert.strictEqual(acct.simulationInvestments.length, 1, "exactly one investment");
    });

    await ok("temporary provider failure: investment untouched, retry scheduled, then delivered", async function() {
        failureMode = "temporary";
        const before = sent.length;
        const result = await enrollInSimulationPlan("grace@example.com", "sim-plan-eth-default", 500);
        assert.ok(result.ok, "investment still succeeds when email fails");
        failureMode = null;
        assert.strictEqual(sent.length, before);
        const list = await emails.listInvestmentEmails({});
        const row = list.notifications.find(function(n) { return n.investmentId === result.position.id; });
        assert.strictEqual(row.status, "queued");
        assert.strictEqual(row.attempts, 1);
        assert.ok(row.failureReason.indexOf("temporarily unavailable") !== -1);
        assert.ok(row.nextAttemptAt);

        let run = await emails.processDueNotifications({});
        assert.strictEqual(run.sent, 0, "not due yet");

        const rows = JSON.parse(fs.readFileSync(emails.LOCAL_STORE_PATH, "utf8"));
        rows.forEach(function(r) { if (r.status === "queued") r.next_attempt_at = new Date(Date.now() - 1000).toISOString(); });
        fs.writeFileSync(emails.LOCAL_STORE_PATH, JSON.stringify(rows));
        run = await emails.processDueNotifications({});
        assert.strictEqual(run.sent, 1);
        assert.strictEqual(sent.length, before + 1);

        const acct = (await registry.loadAllAccounts())["grace@example.com"];
        assert.strictEqual(acct.simulationInvestments.length, 2, "retry did not duplicate the investment");
    });

    let failedId;
    await ok("retries exhausted: marked Failed, admin alerted, investment unchanged", async function() {
        failureMode = "temporary";
        const result = await enrollInSimulationPlan("grace@example.com", "sim-plan-sol-default", 300);
        assert.ok(result.ok);
        for (let i = 0; i < 6; i++) {
            const rows = JSON.parse(fs.readFileSync(emails.LOCAL_STORE_PATH, "utf8"));
            rows.forEach(function(r) { if (r.status === "queued") r.next_attempt_at = new Date(Date.now() - 1000).toISOString(); });
            fs.writeFileSync(emails.LOCAL_STORE_PATH, JSON.stringify(rows));
            await emails.processDueNotifications({});
        }
        const list = await emails.listInvestmentEmails({ status: "failed" });
        const row = list.notifications.find(function(n) { return n.investmentId === result.position.id; });
        assert.ok(row, "failed row exists");
        assert.strictEqual(row.attempts, 5);
        assert.ok(row.canRetry);
        assert.ok(row.failureReason);
        failedId = row.id;
        failureMode = null;
        const alert = sent.find(function(m) { return m.payload.to === "ops@globalvestbank.com"; });
        assert.ok(alert, "admin alert email sent");
        assert.ok(alert.payload.text.indexOf("Provider temporarily unavailable") !== -1);
        assert.ok(alert.payload.text.indexOf(row.reference) !== -1);
        const stored = JSON.parse(fs.readFileSync(emails.LOCAL_STORE_PATH, "utf8")).find(function(r) { return r.id === row.id; });
        assert.ok(stored.admin_alerted_at, "alert time recorded");
    });

    await ok("admin API requires authorization", async function() {
        const res = mockRes();
        await adminApi({ method: "GET", query: { action: "list" }, headers: {} }, res);
        assert.strictEqual(res.statusCode, 401);
        const bad = mockRes();
        await adminApi({ method: "GET", query: { action: "list", adminEmail: "admin@globalvest.com", adminPassword: "wrong" }, headers: {} }, bad);
        assert.strictEqual(bad.statusCode, 403);
    });

    await ok("admin retry re-sends once using the same record (no duplicate investment)", async function() {
        const before = sent.length;
        const accountsBefore = (await registry.loadAllAccounts())["grace@example.com"].simulationInvestments.length;
        const res = mockRes();
        await adminApi({
            method: "POST",
            headers: {},
            body: { action: "retry", id: failedId, adminEmail: "admin@globalvest.com", adminPassword: "admin123" }
        }, res);
        assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
        assert.strictEqual(res.body.notification.status, "sent");
        assert.strictEqual(sent.length, before + 1);
        assert.ok(/:r1$/.test(sent[sent.length - 1].options.idempotencyKey), "new provider idempotency generation");

        const accountsAfter = (await registry.loadAllAccounts())["grace@example.com"].simulationInvestments.length;
        assert.strictEqual(accountsAfter, accountsBefore);

        const second = mockRes();
        await adminApi({
            method: "POST",
            headers: {},
            body: { action: "retry", id: failedId, adminEmail: "admin@globalvest.com", adminPassword: "admin123" }
        }, second);
        assert.strictEqual(second.statusCode, 400, "a sent email cannot be retried again");
        assert.strictEqual(sent.length, before + 1);
    });

    await ok("permanent provider error fails immediately without retry loop", async function() {
        failureMode = "permanent";
        const result = await enrollInSimulationPlan("grace@example.com", "sim-plan-xrp-default", 200);
        failureMode = null;
        assert.ok(result.ok);
        const list = await emails.listInvestmentEmails({});
        const row = list.notifications.find(function(n) { return n.investmentId === result.position.id; });
        assert.strictEqual(row.status, "failed");
        assert.strictEqual(row.attempts, 1);
        assert.ok(row.failureReason.indexOf("not verified") !== -1);
    });

    await ok("pending / unverified purchases never send a confirmation", async function() {
        const before = sent.length;
        const pending = await emails.enqueueInvestmentConfirmation({
            investmentId: "pending-1", reference: "GV-INV-PENDING", email: "ada@example.com",
            assetName: "Gold", amount: 100, durationDays: 365, dailyReturn: 10, paymentStatus: "pending"
        });
        assert.ok(pending.skipped);
        const unverified = await enrollInSimulationPlan("linus@example.com", "sim-plan-btc-default", 150);
        assert.ok(unverified.ok);
        assert.strictEqual(sent.length, before);
        const list = await emails.listInvestmentEmails({});
        const row = list.notifications.find(function(n) { return n.customerEmail === "linus@example.com"; });
        assert.strictEqual(row.status, "failed");
        assert.ok(/not verified/i.test(row.failureReason));
        assert.strictEqual(row.canRetry, false, "unverified recipients are not retryable");
    });

    await ok("webhook: signature required, delivered recorded, no downgrade on late events", async function() {
        const list = await emails.listInvestmentEmails({});
        const row = list.notifications.find(function(n) { return n.investmentId === goldInvestmentId; });

        const unsigned = await postWebhook({ type: "email.delivered", data: { email_id: row.providerMessageId } }, {
            "svix-id": "x", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA"
        });
        assert.strictEqual(unsigned.statusCode, 401);
        const stale = await postWebhook({ type: "email.delivered", data: { email_id: row.providerMessageId } },
            signWebhook("{}", process.env.RESEND_WEBHOOK_SECRET, "old", 1000));
        assert.strictEqual(stale.statusCode, 401);

        const delivered = await postWebhook({
            type: "email.delivered", created_at: "2026-10-27T01:00:00.000Z", data: { email_id: row.providerMessageId }
        });
        assert.strictEqual(delivered.statusCode, 200);
        assert.strictEqual(delivered.body.status, "delivered");

        await postWebhook({ type: "email.sent", data: { email_id: row.providerMessageId } });
        await postWebhook({ type: "email.delivery_delayed", data: { email_id: row.providerMessageId } });
        const after = (await emails.listInvestmentEmails({})).notifications.find(function(n) { return n.id === row.id; });
        assert.strictEqual(after.status, "delivered");
        assert.strictEqual(after.deliveredAt, "2026-10-27T01:00:00.000Z");
    });

    await ok("webhook: bounce and complaint recorded with reason; deferred recorded", async function() {
        const rows = (await emails.listInvestmentEmails({})).notifications.filter(function(n) { return n.providerMessageId; });
        const bounceTarget = rows.find(function(n) { return n.customerEmail === "grace@example.com" && n.status === "sent"; });
        const bounce = await postWebhook({
            type: "email.bounced",
            data: { email_id: bounceTarget.providerMessageId, bounce: { message: "Mailbox does not exist", type: "Permanent" } }
        });
        assert.strictEqual(bounce.body.status, "bounced");
        const after = (await emails.listInvestmentEmails({})).notifications.find(function(n) { return n.id === bounceTarget.id; });
        assert.strictEqual(after.status, "bounced");
        assert.ok(after.failureReason.indexOf("Mailbox does not exist") !== -1);

        const other = rows.find(function(n) { return n.id !== bounceTarget.id && n.status === "sent"; });
        if (other) {
            const deferred = await postWebhook({ type: "email.delivery_delayed", data: { email_id: other.providerMessageId } });
            assert.strictEqual(deferred.body.status, "deferred");
        }
        const ignored = await postWebhook({ type: "email.opened", data: { email_id: "x" } });
        assert.ok(ignored.body.ignored);
    });

    await ok("webhook fallback lookup by notification_id tag", async function() {
        const row = (await emails.listInvestmentEmails({})).notifications.find(function(n) { return n.status === "deferred" || n.status === "sent"; });
        if (!row) return;
        const res = await postWebhook({ type: "email.delivered", data: { email_id: "unknown", tags: { notification_id: row.id } } });
        assert.strictEqual(res.body.status, "delivered");
    });

    await ok("sender falls back to the verified default if configured on a different domain", async function() {
        process.env.INVESTMENT_EMAIL_FROM = "GlobalVest Investments <investments@other-domain.com>";
        const sender = emails.getInvestmentSender();
        assert.ok(sender.usingFallback);
        assert.ok(sender.from.indexOf("@globalvestbank.com") !== -1);
        delete process.env.INVESTMENT_EMAIL_FROM;
    });

    await ok("template escapes customer-controlled values and rejects non-https links", async function() {
        const built = template.buildInvestmentConfirmationEmail({
            customerName: "<script>alert(1)</script>",
            assetName: "Gold", reference: "REF", amount: 1, durationDays: 10, hourlyEarnings: 1,
            totalEarnings: 1, totalValue: 2, startDate: new Date().toISOString(), endDate: new Date().toISOString(),
            viewUrl: "javascript:alert(1)"
        });
        assert.ok(built.html.indexOf("<script>alert") === -1);
        assert.ok(built.html.indexOf("javascript:") === -1);
        assert.ok(built.html.indexOf("https://globalvestbank.com/investments") !== -1);
    });

    console.log("\n" + passed + " checks passed" + (process.exitCode ? " (with failures)" : ""));
}

main().catch(function(err) {
    console.error(err);
    process.exitCode = 1;
}).then(function() {
    fs.rmSync(tmp, { recursive: true, force: true });
});
