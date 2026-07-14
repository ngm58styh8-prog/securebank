const {
    normalizeRegistryEmail,
    loadAllAccounts,
    upsertAccount,
    loadAdminRegistry,
    saveAdminRegistry
} = require("./registry");
const { getSupabaseServiceRoleClient } = require("./supabase");

const GOLD_PAYOUTS_TABLE = "gold_payouts";
const DEFAULT_DAILY_RETURN = 1500;
const MS_CREDIT_INTERVAL = 3 * 60 * 1000;

function todayUtcDateString() {
    return new Date().toISOString().slice(0, 10);
}

function generateReference(email, planId, creditTime) {
    const stamp = new Date(creditTime).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const hash = Buffer.from(email + planId + stamp).toString("hex").slice(0, 8);
    return "GV-GOLD-" + stamp + "-" + hash.toUpperCase();
}

function generateId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
}

function ensureGoldInvestmentShape(account) {
    if (!account.goldInvestment || typeof account.goldInvestment !== "object") {
        account.goldInvestment = createEmptyGoldInvestment();
    }
    const gi = account.goldInvestment;
    if (!Array.isArray(gi.history)) gi.history = [];
    if (!gi.status) gi.status = gi.active ? "active" : "inactive";
    return gi;
}

function createEmptyGoldInvestment() {
    return {
        active: false,
        planId: null,
        planName: null,
        investmentId: null,
        investedAmount: 0,
        balance: 0,
        totalEarned: 0,
        dailyReturn: 0,
        todayReturn: 0,
        startDate: null,
        nextCreditAt: null,
        lastCreditDate: null,
        status: "inactive",
        history: []
    };
}

function createDefaultGoldPlan() {
    const now = new Date().toISOString();
    return {
        id: "gold-plan-default",
        name: "GlobalVest Gold Elite",
        minInvestment: 1000,
        maxInvestment: 1000000,
        dailyReturn: DEFAULT_DAILY_RETURN,
        durationDays: 365,
        enabled: true,
        paused: false,
        createdAt: now,
        updatedAt: now
    };
}

async function ensureAdminGoldPlans(admin) {
    if (!admin) admin = await loadAdminRegistry();
    if (!Array.isArray(admin.goldPlans)) admin.goldPlans = [];
    if (!Array.isArray(admin.goldPayoutLog)) admin.goldPayoutLog = [];

    if (!admin.goldPlans.length) {
        admin.goldPlans.push(createDefaultGoldPlan());
        await saveAdminRegistry(admin);
    } else {
        admin.goldPlans = admin.goldPlans.map(function(plan) {
            if (String(plan.id) === "gold-plan-default") {
                return Object.assign({}, plan, { dailyReturn: DEFAULT_DAILY_RETURN });
            }
            return plan;
        });
    }
    return admin;
}

function findGoldPlan(admin, planId) {
    return (admin.goldPlans || []).find(function(p) {
        return String(p.id) === String(planId);
    }) || null;
}

function getEnabledGoldPlans(admin) {
    return (admin.goldPlans || []).filter(function(p) {
        return p.enabled !== false && p.paused !== true;
    });
}

async function logGoldPayout(entry) {
    try {
        const supabase = getSupabaseServiceRoleClient();
        const { error } = await supabase.from(GOLD_PAYOUTS_TABLE).insert({
            id: entry.id,
            reference: entry.reference,
            user_email: entry.userEmail,
            plan_id: entry.planId,
            investment_id: entry.investmentId || null,
            amount: entry.amount,
            credit_date: entry.creditDate,
            status: entry.status || "completed",
            created_at: entry.createdAt || new Date().toISOString()
        });
        if (error) {
            console.warn("[gold] supabase payout log failed:", error.message);
        }
    } catch (err) {
        console.warn("[gold] payout log skipped:", err.message || err);
    }

    try {
        const admin = await loadAdminRegistry();
        if (!Array.isArray(admin.goldPayoutLog)) admin.goldPayoutLog = [];
        admin.goldPayoutLog.unshift({
            id: entry.id,
            reference: entry.reference,
            userEmail: entry.userEmail,
            planId: entry.planId,
            amount: entry.amount,
            creditDate: entry.creditDate,
            status: entry.status || "completed",
            createdAt: entry.createdAt || new Date().toISOString()
        });
        if (admin.goldPayoutLog.length > 2000) {
            admin.goldPayoutLog = admin.goldPayoutLog.slice(0, 2000);
        }
        await saveAdminRegistry(admin);
    } catch (adminErr) {
        console.warn("[gold] admin payout log failed:", adminErr.message || adminErr);
    }
}

async function appendGoldHistory(account, entry) {
    const gi = ensureGoldInvestmentShape(account);
    gi.history.unshift(entry);
    if (gi.history.length > 100) gi.history = gi.history.slice(0, 100);
}

function computeNextCreditAt(fromDate) {
    const base = fromDate ? new Date(fromDate) : new Date();
    return new Date(base.getTime() + MS_CREDIT_INTERVAL).toISOString();
}

async function processDailyCreditForUser(email, options) {
    options = options || {};
    const key = normalizeRegistryEmail(email);
    if (!key) {
        return { ok: false, error: "Invalid email." };
    }

    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    const gi = ensureGoldInvestmentShape(account);
    if (!gi.active || gi.status !== "active" || !gi.planId) {
        return { ok: true, credited: false, skipped: true, reason: "No active gold investment." };
    }

    if (gi.nextCreditAt && !options.force) {
        const remaining = new Date(gi.nextCreditAt).getTime() - Date.now();
        if (remaining > MS_CREDIT_INTERVAL * 2) {
            gi.nextCreditAt = new Date().toISOString();
        }
    }

    const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
    const plan = findGoldPlan(admin, gi.planId);
    if (!plan || plan.enabled === false || plan.paused === true) {
        return { ok: true, credited: false, skipped: true, reason: "Plan inactive or paused." };
    }

    if (gi.nextCreditAt && new Date(gi.nextCreditAt).getTime() > Date.now() && !options.force) {
        return {
            ok: true,
            credited: false,
            skipped: true,
            reason: "Next credit not due yet.",
            nextCreditAt: gi.nextCreditAt
        };
    }

    const dailyAmount = Number(plan.dailyReturn) || DEFAULT_DAILY_RETURN;
    if (dailyAmount <= 0 || isNaN(dailyAmount)) {
        return { ok: false, error: "Invalid daily return on plan." };
    }

    const creditTime = new Date();
    const today = todayUtcDateString();
    const reference = generateReference(key, gi.planId, creditTime);
    const payoutId = generateId("gpay");

    const updated = Object.assign({}, account);
    ensureGoldInvestmentShape(updated);
    const ugi = updated.goldInvestment;

    ugi.totalEarned = Number(ugi.totalEarned || 0) + dailyAmount;
    ugi.todayReturn = dailyAmount;
    ugi.lastCreditDate = today;
    ugi.lastCreditAt = creditTime.toISOString();
    ugi.nextCreditAt = computeNextCreditAt(creditTime);
    ugi.dailyReturn = dailyAmount;

    updated.cash = Number(updated.cash || 0) + dailyAmount;
    updated.transactions = Array.isArray(updated.transactions) ? updated.transactions.slice() : [];
    updated.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Gold Investment Daily Return — " + (ugi.planName || plan.name),
        amount: dailyAmount
    });

    const historyEntry = {
        id: payoutId,
        investmentId: ugi.investmentId,
        reference: reference,
        dailyReturn: dailyAmount,
        amountCredited: dailyAmount,
        date: new Date().toISOString(),
        creditDate: today,
        status: "completed",
        planId: gi.planId,
        planName: ugi.planName || plan.name
    };

    await appendGoldHistory(updated, historyEntry);

    updated.notifications = Array.isArray(updated.notifications) ? updated.notifications.slice() : [];
    updated.notifications.unshift({
        id: Date.now() + Math.random(),
        message: "Your Gold Investment generated today's return of $" + dailyAmount.toFixed(2) + ".",
        title: "Gold return credited",
        time: new Date().toISOString(),
        read: false,
        type: "gold",
        category: "gold",
        amount: dailyAmount,
        currency: "USD",
        status: "completed",
        reference: reference
    });
    if (updated.notifications.length > 30) {
        updated.notifications = updated.notifications.slice(0, 30);
    }

    const saved = await upsertAccount(key, updated, {
        cashAuthoritative: true,
        eventType: "gold-credit",
        source: "processDailyCreditForUser"
    });

    await logGoldPayout({
        id: payoutId,
        reference: reference,
        userEmail: key,
        planId: gi.planId,
        investmentId: ugi.investmentId,
        amount: dailyAmount,
        creditDate: today,
        status: "completed",
        createdAt: new Date().toISOString()
    });

    console.log("[gold] daily credit", {
        userEmail: key,
        amount: dailyAmount,
        reference: reference,
        planId: gi.planId
    });

    return {
        ok: true,
        credited: true,
        amount: dailyAmount,
        reference: reference,
        account: saved.account,
        goldInvestment: saved.account.goldInvestment,
        notification: historyEntry
    };
}

async function enrollInGoldPlan(email, planId, amount) {
    const key = normalizeRegistryEmail(email);
    amount = Number(amount);
    if (!key) throw new Error("Missing or invalid email.");
    if (!planId) throw new Error("Missing plan.");
    if (!amount || amount <= 0 || isNaN(amount)) {
        throw new Error("Enter a valid investment amount.");
    }

    const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
    const plan = findGoldPlan(admin, planId);
    if (!plan) throw new Error("Gold plan not found.");
    if (plan.enabled === false) throw new Error("This gold plan is disabled.");
    if (plan.paused === true) throw new Error("This gold plan is paused.");

    if (amount < Number(plan.minInvestment)) {
        throw new Error("Minimum investment is $" + Number(plan.minInvestment).toFixed(2) + ".");
    }
    if (amount > Number(plan.maxInvestment)) {
        throw new Error("Maximum investment is $" + Number(plan.maxInvestment).toFixed(2) + ".");
    }

    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) throw new Error("Account not found.");

    const gi = ensureGoldInvestmentShape(account);
    if (gi.active && gi.status === "active") {
        throw new Error("You already have an active Gold Investment. Contact support to change plans.");
    }

    if (Number(account.cash || 0) < amount) {
        throw new Error("Insufficient available balance.");
    }

    const investmentId = generateId("ginv");
    const now = new Date().toISOString();

    const updated = Object.assign({}, account);
    updated.cash = Number(account.cash || 0) - amount;
    ensureGoldInvestmentShape(updated);
    updated.goldInvestment = {
        active: true,
        planId: plan.id,
        planName: plan.name,
        investmentId: investmentId,
        investedAmount: amount,
        balance: amount,
        totalEarned: 0,
        dailyReturn: Number(plan.dailyReturn) || DEFAULT_DAILY_RETURN,
        todayReturn: 0,
        startDate: now,
        nextCreditAt: now,
        lastCreditDate: null,
        lastCreditAt: null,
        status: "active",
        history: []
    };

    updated.transactions = Array.isArray(account.transactions) ? account.transactions.slice() : [];
    updated.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Gold Investment Enrolled — " + plan.name,
        amount: -amount
    });

    updated.notifications = Array.isArray(account.notifications) ? account.notifications.slice() : [];
    updated.notifications.unshift({
        id: Date.now() + Math.random(),
        message: "Gold Investment activated with $" + amount.toFixed(2) + " in " + plan.name + ".",
        title: "Gold Investment started",
        time: now,
        read: false,
        type: "gold",
        category: "gold",
        amount: amount,
        currency: "USD",
        status: "completed",
        reference: investmentId
    });

    const saved = await upsertAccount(key, updated, {
        cashAuthoritative: true,
        eventType: "gold-enroll",
        source: "enrollInGoldPlan"
    });

    if (!Array.isArray(admin.goldInvestors)) admin.goldInvestors = [];
    const existingIdx = admin.goldInvestors.findIndex(function(e) {
        return normalizeRegistryEmail(e.userEmail) === key;
    });
    const investorEntry = {
        userEmail: key,
        userName: account.profile ? account.profile.fullName : key,
        planId: plan.id,
        planName: plan.name,
        investmentId: investmentId,
        investedAmount: amount,
        startDate: now,
        status: "active"
    };
    if (existingIdx >= 0) admin.goldInvestors[existingIdx] = investorEntry;
    else admin.goldInvestors.unshift(investorEntry);
    await saveAdminRegistry(admin);

    return {
        ok: true,
        account: saved.account,
        goldInvestment: saved.account.goldInvestment,
        plan: plan
    };
}

async function getGoldStatus(email) {
    const key = normalizeRegistryEmail(email);
    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) return { ok: false, error: "Account not found." };

    const creditResult = await processDailyCreditForUser(key);
    const refreshed = creditResult.account || (await loadAllAccounts())[key] || account;
    const gi = ensureGoldInvestmentShape(refreshed);

    let plan = null;
    if (gi.planId) {
        const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
        plan = findGoldPlan(admin, gi.planId);
    }

    return {
        ok: true,
        goldInvestment: gi,
        plan: plan,
        cash: Number(refreshed.cash || 0),
        credited: !!creditResult.credited,
        creditAmount: creditResult.amount || 0,
        account: creditResult.account || refreshed
    };
}

async function getGoldHistory(email) {
    const key = normalizeRegistryEmail(email);
    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) return { ok: false, error: "Account not found." };

    const gi = ensureGoldInvestmentShape(account);
    let payouts = [];

    try {
        const supabase = getSupabaseServiceRoleClient();
        const { data } = await supabase
            .from(GOLD_PAYOUTS_TABLE)
            .select("*")
            .eq("user_email", key)
            .order("created_at", { ascending: false })
            .limit(100);
        if (data && data.length) {
            payouts = data.map(function(row) {
                return {
                    id: row.id,
                    reference: row.reference,
                    dailyReturn: Number(row.amount),
                    amountCredited: Number(row.amount),
                    date: row.created_at,
                    creditDate: row.credit_date,
                    status: row.status,
                    planId: row.plan_id,
                    investmentId: row.investment_id
                };
            });
        }
    } catch (err) {
        console.warn("[gold] history fetch:", err.message || err);
    }

    if (!payouts.length && gi.history.length) {
        payouts = gi.history.slice();
    }

    return {
        ok: true,
        history: payouts,
        goldInvestment: gi
    };
}

async function listGoldPlans() {
    const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
    return {
        ok: true,
        plans: admin.goldPlans || []
    };
}

async function upsertGoldPlan(plan, options) {
    options = options || {};
    const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
    if (!plan || !plan.name) throw new Error("Plan name is required.");

    const now = new Date().toISOString();
    const normalized = {
        id: plan.id || generateId("gold-plan"),
        name: String(plan.name).trim(),
        minInvestment: Number(plan.minInvestment) || 1000,
        maxInvestment: Number(plan.maxInvestment) || 1000000,
        dailyReturn: Number(plan.dailyReturn) || DEFAULT_DAILY_RETURN,
        durationDays: Number(plan.durationDays) || 365,
        enabled: plan.enabled !== false,
        paused: !!plan.paused,
        createdAt: plan.createdAt || now,
        updatedAt: now
    };

    const idx = (admin.goldPlans || []).findIndex(function(p) {
        return String(p.id) === String(normalized.id);
    });

    if (options.delete) {
        if (idx < 0) throw new Error("Plan not found.");
        admin.goldPlans.splice(idx, 1);
        await saveAdminRegistry(admin);
        return { ok: true, deleted: true, planId: normalized.id };
    }

    if (idx >= 0) {
        admin.goldPlans[idx] = Object.assign({}, admin.goldPlans[idx], normalized);
    } else {
        if (!plan.id && !options.allowCreate) {
            throw new Error("Plan not found.");
        }
        admin.goldPlans.unshift(normalized);
    }

    await saveAdminRegistry(admin);
    return { ok: true, plan: normalized, plans: admin.goldPlans };
}

async function processAllDailyCredits() {
    const accounts = await loadAllAccounts();
    const results = [];
    let credited = 0;

    for (const email of Object.keys(accounts)) {
        const key = normalizeRegistryEmail(email);
        const acct = accounts[email];
        if (!acct || !acct.goldInvestment || !acct.goldInvestment.active) continue;

        try {
            const result = await processDailyCreditForUser(key);
            results.push({ email: key, result: result });
            if (result.credited) credited += 1;
        } catch (err) {
            results.push({
                email: key,
                error: err.message || String(err)
            });
        }
    }

    return { ok: true, credited: credited, results: results };
}

async function searchGoldInvestors(query) {
    const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
    const accounts = await loadAllAccounts();
    const q = String(query || "").trim().toLowerCase();
    const investors = [];

    Object.keys(accounts).forEach(function(email) {
        const key = normalizeRegistryEmail(email);
        const acct = accounts[email];
        if (!acct || !acct.goldInvestment || !acct.goldInvestment.active) return;

        const gi = acct.goldInvestment;
        const name = acct.profile ? acct.profile.fullName : key;
        if (q && key.indexOf(q) === -1 && name.toLowerCase().indexOf(q) === -1) return;

        investors.push({
            userEmail: key,
            userName: name,
            planId: gi.planId,
            planName: gi.planName,
            investedAmount: gi.investedAmount,
            totalEarned: gi.totalEarned,
            dailyReturn: gi.dailyReturn,
            startDate: gi.startDate,
            status: gi.status,
            lastCreditDate: gi.lastCreditDate
        });
    });

    return {
        ok: true,
        investors: investors,
        payoutLog: (admin.goldPayoutLog || []).slice(0, 200)
    };
}

module.exports = {
    DEFAULT_DAILY_RETURN,
    MS_CREDIT_INTERVAL,
    createEmptyGoldInvestment,
    ensureGoldInvestmentShape,
    ensureAdminGoldPlans,
    listGoldPlans,
    upsertGoldPlan,
    enrollInGoldPlan,
    processDailyCreditForUser,
    processAllDailyCredits,
    getGoldStatus,
    getGoldHistory,
    searchGoldInvestors,
    getEnabledGoldPlans,
    findGoldPlan
};
