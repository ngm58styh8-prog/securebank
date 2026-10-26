#!/usr/bin/env node
const assert = require("assert");
const { simulatedDailyReturnCents, toCents, fromCents } = require("../server-lib/decimal-money");
const { planDailyReturnCents } = require("../server-lib/simulation-investments");

function testPercentCases() {
    const cases = [
        [1000, 1, 10],
        [10000, 1, 100],
        [50000, 1, 500],
        [150000, 1, 1500]
    ];
    cases.forEach(function(c) {
        const cents = simulatedDailyReturnCents(toCents(c[0]), c[1]);
        assert.strictEqual(fromCents(cents), c[2], "$" + c[0] + " @ " + c[1] + "%");
    });
}

function testPlanHelper() {
    const plan = { returnType: "percent", dailyReturnPercent: 1 };
    assert.strictEqual(fromCents(planDailyReturnCents(plan, toCents(150000))), 1500);
}

function testFixedPlan() {
    const plan = { returnType: "fixed", dailyReturnFixed: 25 };
    assert.strictEqual(fromCents(planDailyReturnCents(plan, toCents(1000))), 25);
}

testPercentCases();
testPlanHelper();
testFixedPlan();
console.log("simulation investment tests: 6 passed");
