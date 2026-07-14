#!/usr/bin/env node
/**
 * Unit tests for notification data shape and merge behavior.
 * Run: npm run test:notifications
 */
const assert = require("assert");

function mergeNotificationLists(primary, secondary) {
    const map = new Map();
    (secondary || []).forEach(function(n) {
        map.set(String(n.id), n);
    });
    (primary || []).forEach(function(n) {
        map.set(String(n.id), n);
    });
    return Array.from(map.values())
        .sort(function(a, b) { return new Date(b.time) - new Date(a.time); })
        .slice(0, 30);
}

function pushAccountNotification(account, message, options) {
    options = options || {};
    if (!account.notifications) account.notifications = [];
    account.notifications.unshift({
        id: options.id || (Date.now() + Math.random()),
        message: message,
        title: options.title || null,
        time: options.time || new Date().toISOString(),
        read: false,
        type: options.type || options.category || "general",
        category: options.category || options.type || "general",
        amount: options.amount != null && !isNaN(Number(options.amount)) ? Number(options.amount) : null,
        currency: options.currency || (options.amount != null ? "USD" : null),
        status: options.status || "completed",
        reference: options.reference || null
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }
    return account.notifications;
}

function getUnreadNotificationCount(account) {
    if (!account || !Array.isArray(account.notifications)) return 0;
    return account.notifications.filter(function(n) { return !n.read; }).length;
}

function markNotificationRead(account, notificationId) {
    const target = (account.notifications || []).find(function(n) {
        return String(n.id) === String(notificationId);
    });
    if (!target || target.read) return false;
    target.read = true;
    return true;
}

const account = { notifications: [] };

pushAccountNotification(account, "Deposit submitted — awaiting admin approval", {
    type: "deposit",
    title: "Deposit submitted",
    amount: 250,
    currency: "USD",
    status: "pending"
});

assert.strictEqual(account.notifications.length, 1);
assert.strictEqual(account.notifications[0].status, "pending");
assert.strictEqual(account.notifications[0].amount, 250);
assert.strictEqual(getUnreadNotificationCount(account), 1);

pushAccountNotification(account, "Funds received — Ref GV-123", {
    type: "transfer",
    title: "Funds received",
    amount: 75,
    currency: "USD",
    status: "completed",
    reference: "GV-123"
});

assert.strictEqual(account.notifications[0].type, "transfer");
assert.strictEqual(account.notifications[0].status, "completed");

const merged = mergeNotificationLists(
    [{ id: "2", message: "newer", time: "2026-07-13T12:00:00.000Z", read: false }],
    [{ id: "1", message: "older", time: "2026-07-12T12:00:00.000Z", read: true }]
);
assert.strictEqual(merged[0].id, "2");
assert.strictEqual(merged.length, 2);

const firstId = account.notifications[1].id;
assert.strictEqual(markNotificationRead(account, firstId), true);
assert.strictEqual(getUnreadNotificationCount(account), 1);

console.log("notification tests: 5 passed");
