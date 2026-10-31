"use strict";

const assert = require("assert");
const { buildAdminAdjustContent } = require("../server-lib/admin-adjust-emails");

const credit = buildAdminAdjustContent({
    userEmail: "ada@example.com",
    account: { cash: 14200, profile: { fullName: "Ada Lovelace" } },
    action: "credit",
    amount: 200,
    note: "Verified wire deposit",
    reference: "GV-DEP-20261031-TESTREF1",
    admin: { websiteSettings: { siteName: "GlobalVest Bank" } }
});

assert.strictEqual(credit.subject, "GlobalVest Bank | Deposit Confirmation");
assert.ok(credit.body.indexOf("Dear Ada,") !== -1);
assert.ok(credit.body.indexOf("$200.00") !== -1);
assert.ok(credit.body.indexOf("GV-DEP-20261031-TESTREF1") !== -1);
assert.ok(credit.body.indexOf("$14200.00") !== -1);
assert.ok(credit.body.indexOf("Completed") !== -1);

const debit = buildAdminAdjustContent({
    userEmail: "ada@example.com",
    account: { cash: 14000, profile: { fullName: "Ada Lovelace" } },
    action: "debit",
    amount: 50,
    note: "Fee correction",
    reference: "GV-ADJ-20261031-TESTREF2",
    admin: { websiteSettings: { siteName: "GlobalVest Bank" } }
});

assert.ok(debit.subject.indexOf("debited") !== -1);
assert.ok(debit.body.indexOf("GV-ADJ-20261031-TESTREF2") !== -1);
assert.strictEqual(debit.category, "admin-debit");

console.log("admin adjust balance tests: passed");
