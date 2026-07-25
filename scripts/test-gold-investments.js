#!/usr/bin/env node
/**
 * Unit tests for Gold Investment credit interval + merge safety.
 * Run: node scripts/test-gold-investments.js
 */
const assert = require("assert");
const path = require("path");

// --- Pure helpers mirrored from server-lib (no Supabase) ---
const MS_CREDIT_INTERVAL = 3 * 60 * 1000;
const DEFAULT_DAILY_RETURN = 1500;

function computeNextCreditAt(fromDate) {
    const base = fromDate ? new Date(fromDate) : new Date();
    return new Date(base.getTime() + MS_CREDIT_INTERVAL).toISOString();
}

function shouldCredit(gi, now, force) {
    if (!gi.active || gi.status !== "active" || !gi.planId) {
        return { credit: false, reason: "inactive" };
    }
    let next = gi.nextCreditAt;
    if (next && !force) {
        const remaining = new Date(next).getTime() - now;
        if (remaining > MS_CREDIT_INTERVAL * 2) {
            next = new Date(now).toISOString();
        }
    }
    if (next && new Date(next).getTime() > now && !force) {
        return { credit: false, reason: "not-due", nextCreditAt: next };
    }
    return {
        credit: true,
        amount: Number(gi.dailyReturn) || DEFAULT_DAILY_RETURN,
        nextCreditAt: computeNextCreditAt(now)
    };
}

function goldCreditTimestamp(gi) {
    if (!gi || typeof gi !== "object") return 0;
    if (gi.lastCreditAt) {
        const t = new Date(gi.lastCreditAt).getTime();
        return isNaN(t) ? 0 : t;
    }
    if (gi.lastCreditDate) {
        const t = new Date(gi.lastCreditDate).getTime();
        return isNaN(t) ? 0 : t;
    }
    return 0;
}

function mergeGoldInvestmentState(existingGi, incomingGi, options) {
    options = options || {};
    if (options.goldAuthoritative && incomingGi && typeof incomingGi === "object") {
        return incomingGi;
    }
    if (!incomingGi || typeof incomingGi !== "object") {
        return existingGi && typeof existingGi === "object" ? existingGi : incomingGi;
    }
    if (!existingGi || typeof existingGi !== "object") {
        return incomingGi;
    }

    const existingTs = goldCreditTimestamp(existingGi);
    const incomingTs = goldCreditTimestamp(incomingGi);
    if (existingTs > incomingTs) return existingGi;
    if (incomingTs > existingTs) return incomingGi;

    const existingEarned = Number(existingGi.totalEarned || 0);
    const incomingEarned = Number(incomingGi.totalEarned || 0);
    if (existingEarned > incomingEarned) return existingGi;
    if (incomingEarned > existingEarned) return incomingGi;

    if (existingGi.active && !incomingGi.active) return existingGi;
    if (incomingGi.active && !existingGi.active) return incomingGi;

    const existingHist = Array.isArray(existingGi.history) ? existingGi.history.length : 0;
    const incomingHist = Array.isArray(incomingGi.history) ? incomingGi.history.length : 0;
    if (existingHist > incomingHist) return existingGi;

    return incomingGi;
}

// 1) Immediate credit on enroll (nextCreditAt = now)
{
    const now = Date.now();
    const r = shouldCredit({
        active: true,
        status: "active",
        planId: "gold-plan-default",
        dailyReturn: 1500,
        nextCreditAt: new Date(now).toISOString()
    }, now);
    assert.strictEqual(r.credit, true);
    assert.strictEqual(r.amount, 1500);
}

// 2) Not due yet
{
    const now = Date.now();
    const r = shouldCredit({
        active: true,
        status: "active",
        planId: "p1",
        dailyReturn: 1500,
        nextCreditAt: new Date(now + 90000).toISOString()
    }, now);
    assert.strictEqual(r.credit, false);
    assert.strictEqual(r.reason, "not-due");
}

// 3) Legacy 24h countdown auto-resets and credits
{
    const now = Date.now();
    const r = shouldCredit({
        active: true,
        status: "active",
        planId: "p1",
        dailyReturn: 1500,
        nextCreditAt: new Date(now + 20 * 60 * 60 * 1000).toISOString()
    }, now);
    assert.strictEqual(r.credit, true);
    assert.strictEqual(r.amount, 1500);
}

// 4) Next credit is ~3 minutes later
{
    const now = Date.now();
    const next = computeNextCreditAt(now);
    const diff = new Date(next).getTime() - now;
    assert.ok(Math.abs(diff - MS_CREDIT_INTERVAL) < 5);
}

// 5) Stale client cannot wipe newer server gold state
{
    const server = {
        active: true,
        totalEarned: 3000,
        lastCreditAt: "2026-07-14T12:00:00.000Z",
        history: [{ id: "1" }, { id: "2" }]
    };
    const client = {
        active: true,
        totalEarned: 1500,
        lastCreditAt: "2026-07-14T11:57:00.000Z",
        history: [{ id: "1" }]
    };
    const merged = mergeGoldInvestmentState(server, client, {});
    assert.strictEqual(merged.totalEarned, 3000);
    assert.strictEqual(merged.history.length, 2);
}

// 6) goldAuthoritative accepts incoming
{
    const server = { totalEarned: 100, lastCreditAt: "2026-07-14T12:00:00.000Z" };
    const incoming = { totalEarned: 1600, lastCreditAt: "2026-07-14T12:03:00.000Z" };
    const merged = mergeGoldInvestmentState(server, incoming, { goldAuthoritative: true });
    assert.strictEqual(merged.totalEarned, 1600);
}

// 7) Default amount is $1500
{
    const now = Date.now();
    const r = shouldCredit({
        active: true,
        status: "active",
        planId: "p1",
        nextCreditAt: new Date(now - 1000).toISOString()
    }, now);
    assert.strictEqual(r.amount, 1500);
}

console.log("gold investment tests: 7 passed");
