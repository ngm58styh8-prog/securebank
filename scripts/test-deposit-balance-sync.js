#!/usr/bin/env node
/**
 * Tests for deposit approval balance merge rules.
 * Run: npm run test:deposit-balance
 */
const assert = require("assert");

function parseRegistrySyncTime(value) {
    if (!value) return 0;
    const time = Date.parse(value);
    return isNaN(time) ? 0 : time;
}

function mergeAccountRecords(serverAcct, localAcct) {
    if (!serverAcct) return localAcct;
    if (!localAcct) return serverAcct;

    const localSynced = parseRegistrySyncTime(localAcct.serverSyncedAt);
    const serverSynced = parseRegistrySyncTime(serverAcct.serverSyncedAt);
    const serverIsNewer = serverSynced >= localSynced;

    const merged = Object.assign({}, serverAcct, localAcct);

    if (typeof serverAcct.cash === "number" && !isNaN(serverAcct.cash)) {
        if (typeof localAcct.cash !== "number" || isNaN(localAcct.cash)) {
            merged.cash = serverAcct.cash;
        } else if (serverIsNewer || serverAcct.cash > localAcct.cash) {
            merged.cash = serverAcct.cash;
        } else {
            merged.cash = localAcct.cash;
        }
    } else if (typeof localAcct.cash === "number" && !isNaN(localAcct.cash)) {
        merged.cash = localAcct.cash;
    }

    merged.serverSyncedAt = serverIsNewer
        ? (serverAcct.serverSyncedAt || localAcct.serverSyncedAt)
        : (localAcct.serverSyncedAt || serverAcct.serverSyncedAt);

    return merged;
}

function testServerHigherCashWinsAfterApproval() {
    const local = { cash: 100, serverSyncedAt: "2026-07-08T01:00:00.000Z" };
    const server = { cash: 350, serverSyncedAt: "2026-07-08T02:00:00.000Z" };
    assert.strictEqual(mergeAccountRecords(server, local).cash, 350);
}

function testStaleLocalLosesToServerCredit() {
    const local = { cash: 100, serverSyncedAt: "2026-07-08T03:00:00.000Z" };
    const server = { cash: 350, serverSyncedAt: "2026-07-08T02:00:00.000Z" };
    assert.strictEqual(mergeAccountRecords(server, local).cash, 350);
}

function testLocalLowerCashKeptWhenServerNotHigher() {
    const local = { cash: 75, serverSyncedAt: "2026-07-08T03:00:00.000Z" };
    const server = { cash: 75, serverSyncedAt: "2026-07-08T02:00:00.000Z" };
    assert.strictEqual(mergeAccountRecords(server, local).cash, 75);
}

function run() {
    testServerHigherCashWinsAfterApproval();
    testStaleLocalLosesToServerCredit();
    testLocalLowerCashKeptWhenServerNotHigher();
    console.log("deposit balance sync tests: 3 passed");
}

run();
