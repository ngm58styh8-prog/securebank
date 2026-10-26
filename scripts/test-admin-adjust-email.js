const assert = require("assert");
const { buildAdminAdjustContent } = require("../server-lib/admin-adjust-emails");

const content = buildAdminAdjustContent({
    userEmail: "user@example.com",
    account: { cash: 500, profile: { fullName: "Jane Doe" } },
    action: "credit",
    amount: 25,
    note: "Welcome bonus",
    admin: { websiteSettings: { siteName: "GlobalVest Bank" } }
});

assert.ok(content.subject.indexOf("credited") !== -1, "credit subject");
assert.ok(content.body.indexOf("$25.00") !== -1, "amount in body");
assert.ok(content.body.indexOf("Welcome bonus") !== -1, "note in body");
assert.ok(content.body.indexOf("$500.00") !== -1, "balance in body");
assert.strictEqual(content.category, "admin-credit");

console.log("admin adjust email tests: passed");
