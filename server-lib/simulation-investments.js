const {
    loadAllAccounts,
    loadAdminRegistry,
    saveAdminRegistry,
    upsertAccount,
    normalizeRegistryEmail
} = require("./registry");
const {
    ensureAdminGoldPlans,
    searchGoldInvestors,
    processAllDailyCredits,
    MS_CREDIT_INTERVAL
} = require("./gold-investments");
const { appendAdminActivityLog } = require("./admin-auth");
const {
    toCents,
    fromCents,
    simulatedDailyReturnCents,
    simulatedDailyReturnFixedCents
} = require("./decimal-money");

const MS_DAY = MS_CREDIT_INTERVAL;

/** Align with js/market-data.js asset ids */
const SIMULATION_ASSETS = [
    { id: "btc", name: "Bitcoin", symbol: "BTC", category: "crypto" },
    { id: "eth", name: "Ethereum", symbol: "ETH", category: "crypto" },
    { id: "usdt", name: "Tether", symbol: "USDT", category: "crypto" },
    { id: "bnb", name: "BNB", symbol: "BNB", category: "crypto" },
    { id: "xrp", name: "XRP", symbol: "XRP", category: "crypto" },
    { id: "sol", name: "Solana", symbol: "SOL", category: "crypto" },
    { id: "gold", name: "Gold", symbol: "XAU", category: "commodities" },
    { id: "oil", name: "Oil", symbol: "WTI", category: "commodities" },
    { id: "tsla", name: "Tesla", symbol: "TSLA", category: "stocks" },
    { id: "aapl", name: "Apple", symbol: "AAPL", category: "stocks" },
    { id: "googl", name: "Alphabet", symbol: "GOOGL", category: "stocks" },
    { id: "msft", name: "Microsoft", symbol: "MSFT", category: "stocks" },
    { id: "nvda", name: "NVIDIA", symbol: "NVDA", category: "stocks" },
    { id: "spy", name: "SPDR S&P 500 ETF", symbol: "SPY", category: "stocks" },
    { id: "qqq", name: "Invesco QQQ ETF", symbol: "QQQ", category: "stocks" },
    { id: "vti", name: "Vanguard Total Market ETF", symbol: "VTI", category: "stocks" },
    { id: "diamond", name: "Diamond", symbol: "DIAMOND", category: "diamond" }
];

const DEFAULT_SIMULATION_SETTINGS = {
    enrollmentsPaused: false,
    creditIntervalHours: 24,
    notifyOnCredit: true,
    educationalLabel: "Simulated — educational only. Not guaranteed real-world earnings.",
    eligibleAssetIds: SIMULATION_ASSETS.map(function(a) { return a.id; })
};

function assetMeta(assetId) {
    return SIMULATION_ASSETS.find(function(a) { return a.id === assetId; }) || {
        id: assetId,
        name: assetId,
        symbol: assetId.toUpperCase(),
        category: "other"
    };
}

function categoryOfAsset(assetId) {
    const meta = assetMeta(assetId);
    if (meta.category === "crypto") return "crypto";
    if (meta.category === "stocks") return "stock";
    if (meta.category === "commodities") return "commodity";
    if (meta.category === "diamond") return "commodity";
    return "other";
}

function ensureSimulationAdmin(admin) {
    admin = admin || {};
    if (!admin.simulationSettings || typeof admin.simulationSettings !== "object") {
        admin.simulationSettings = Object.assign({}, DEFAULT_SIMULATION_SETTINGS);
    } else {
        admin.simulationSettings = Object.assign({}, DEFAULT_SIMULATION_SETTINGS, admin.simulationSettings);
    }
    if (!Array.isArray(admin.simulationPlans)) admin.simulationPlans = [];
    if (!Array.isArray(admin.simulationCreditLog)) admin.simulationCreditLog = [];
    if (!Array.isArray(admin.simulationJobRuns)) admin.simulationJobRuns = [];
    return admin;
}

function ensureAccountSimulations(account) {
    if (!account) return account;
    if (!Array.isArray(account.simulationInvestments)) account.simulationInvestments = [];
    return account;
}

function createDefaultPlanForAsset(assetId) {
    const meta = assetMeta(assetId);
    const now = new Date().toISOString();
    return {
        id: "sim-plan-" + assetId + "-default",
        assetId: assetId,
        name: meta.name + " Simulation 24h",
        minInvestment: 100,
        maxInvestment: 500000,
        returnType: "percent",
        dailyReturnPercent: 1,
        dailyReturnFixed: 0,
        durationDays: 365,
        enabled: assetId !== "diamond",
        paused: false,
        enrollmentsPaused: false,
        createdAt: now,
        updatedAt: now
    };
}

async function ensureDefaultSimulationPlans(admin) {
    admin = ensureSimulationAdmin(admin);
    const byAsset = {};
    admin.simulationPlans.forEach(function(p) {
        if (p && p.assetId) byAsset[p.assetId] = true;
    });
    SIMULATION_ASSETS.forEach(function(a) {
        if (!byAsset[a.id]) admin.simulationPlans.push(createDefaultPlanForAsset(a.id));
    });
    return admin;
}

function planDailyReturnCents(plan, investedCents) {
    if (!plan) return 0;
    if (plan.returnType === "fixed") {
        return simulatedDailyReturnFixedCents(plan.dailyReturnFixed);
    }
    return simulatedDailyReturnCents(investedCents, plan.dailyReturnPercent);
}

function normalizeUnifiedRow(row) {
    return row;
}

function collectGoldRows(investors) {
    return (investors || []).map(function(inv) {
        return {
            source: "gold-legacy",
            id: "gold:" + inv.userEmail,
            userEmail: inv.userEmail,
            userName: inv.userName,
            assetId: "gold",
            assetName: "Gold (Legacy Plan)",
            planId: inv.planId,
            planName: inv.planName,
            investedAmount: Number(inv.investedAmount || 0),
            totalSimulatedEarned: Number(inv.totalEarned || 0),
            dailySimulatedReturn: Number(inv.dailyReturn || 0),
            status: inv.status || "active",
            startDate: inv.startDate,
            nextCreditAt: null,
            category: "commodity"
        };
    });
}

function collectMarketRows(accounts, query, assetFilter, plans) {
    const q = String(query || "").trim().toLowerCase();
    const asset = String(assetFilter || "").trim().toLowerCase();
    const planById = {};
    (plans || []).forEach(function(p) {
        if (p && p.id) planById[p.id] = p;
    });
    const rows = [];

    Object.keys(accounts || {}).forEach(function(email) {
        const key = normalizeRegistryEmail(email);
        const acct = accounts[email];
        if (!acct || !Array.isArray(acct.simulationInvestments)) return;
        const name = acct.profile ? acct.profile.fullName : key;

        acct.simulationInvestments.forEach(function(inv) {
            if (!inv || inv.status !== "active") return;
            if (asset && inv.assetId !== asset) return;
            if (q && key.indexOf(q) === -1 && name.toLowerCase().indexOf(q) === -1) return;

            const investedCents = toCents(inv.investedAmount);
            const plan = planById[inv.planId] || null;
            rows.push({
                source: "market-simulation",
                id: inv.id,
                userEmail: key,
                userName: name,
                assetId: inv.assetId,
                assetName: inv.assetName || assetMeta(inv.assetId).name,
                planId: inv.planId,
                planName: inv.planName,
                investedAmount: fromCents(investedCents),
                totalSimulatedEarned: Number(inv.totalSimulatedEarned || 0),
                dailySimulatedReturn: fromCents(planDailyReturnCents(plan, investedCents)),
                status: inv.status,
                startDate: inv.startDate,
                nextCreditAt: inv.nextCreditAt,
                category: categoryOfAsset(inv.assetId)
            });
        });
    });

    return rows;
}

async function getAdminInvestmentOverview() {
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    await ensureAdminGoldPlans(admin);
    const gold = await searchGoldInvestors("");
    const accounts = await loadAllAccounts();
    const marketRows = collectMarketRows(accounts, "", "", admin.simulationPlans);
    const goldRows = collectGoldRows(gold.investors || []);

    let activeCount = goldRows.length + marketRows.length;
    let investedTotalCents = 0;
    let earnedTotalCents = 0;

    goldRows.forEach(function(r) {
        investedTotalCents += toCents(r.investedAmount);
        earnedTotalCents += toCents(r.totalSimulatedEarned);
    });
    marketRows.forEach(function(r) {
        investedTotalCents += toCents(r.investedAmount);
        earnedTotalCents += toCents(r.totalSimulatedEarned);
    });

    const today = new Date().toISOString().slice(0, 10);
    const creditsToday = (admin.simulationCreditLog || []).filter(function(row) {
        return row && String(row.createdAt || "").slice(0, 10) === today;
    }).length + (admin.goldPayoutLog || []).filter(function(row) {
        return row && String(row.createdAt || row.date || "").slice(0, 10) === today;
    }).length;

    const upcoming = marketRows.filter(function(r) {
        return r.nextCreditAt && new Date(r.nextCreditAt).getTime() <= Date.now() + MS_DAY;
    }).length + goldRows.length;

    const lastJob = (admin.simulationJobRuns || [])[0] || null;
    const failedJobs = (admin.simulationJobRuns || []).filter(function(j) {
        return j && j.status === "failed";
    }).length;

    return {
        ok: true,
        overview: {
            totalActiveSimulations: activeCount,
            totalSimulatedInvestmentUsd: fromCents(investedTotalCents),
            totalSimulatedEarningsUsd: fromCents(earnedTotalCents),
            calculationsCompletedToday: creditsToday,
            upcomingCalculations: upcoming,
            failedCalculationJobs: failedJobs,
            lastJobRun: lastJob,
            educationalLabel: admin.simulationSettings.educationalLabel
        },
        assets: SIMULATION_ASSETS,
        settings: admin.simulationSettings,
        plans: admin.simulationPlans,
        goldPayoutCount: (admin.goldPayoutLog || []).length,
        simulationCreditCount: (admin.simulationCreditLog || []).length
    };
}

async function listAdminInvestments(query, assetFilter) {
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    const accounts = await loadAllAccounts();
    const gold = await searchGoldInvestors(query || "");
    const goldRows = collectGoldRows(gold.investors || []);
    const marketRows = collectMarketRows(accounts, query, assetFilter, admin.simulationPlans);
    const rows = goldRows.concat(marketRows);

    if (assetFilter === "gold") {
        return { ok: true, investments: goldRows };
    }
    if (assetFilter && assetFilter !== "all") {
        return { ok: true, investments: rows.filter(function(r) { return r.assetId === assetFilter; }) };
    }

    return { ok: true, investments: rows };
}

async function listSimulationPlans() {
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    return { ok: true, plans: admin.simulationPlans, settings: admin.simulationSettings, assets: SIMULATION_ASSETS };
}

async function upsertSimulationPlan(plan, options) {
    options = options || {};
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    if (!plan || !plan.assetId) throw new Error("Plan asset is required.");

    const now = new Date().toISOString();
    const normalized = {
        id: plan.id || ("sim-plan-" + Date.now()),
        assetId: String(plan.assetId).trim().toLowerCase(),
        name: String(plan.name || assetMeta(plan.assetId).name + " Plan").trim(),
        minInvestment: Number(plan.minInvestment) || 0,
        maxInvestment: Number(plan.maxInvestment) || 0,
        returnType: plan.returnType === "fixed" ? "fixed" : "percent",
        dailyReturnPercent: Number(plan.dailyReturnPercent) || 0,
        dailyReturnFixed: Number(plan.dailyReturnFixed) || 0,
        durationDays: Number(plan.durationDays) || 365,
        enabled: plan.enabled !== false,
        paused: !!plan.paused,
        enrollmentsPaused: !!plan.enrollmentsPaused,
        updatedAt: now,
        createdAt: plan.createdAt || now
    };

    const idx = admin.simulationPlans.findIndex(function(p) {
        return String(p.id) === String(normalized.id);
    });

    if (options.delete) {
        if (idx < 0) throw new Error("Plan not found.");
        admin.simulationPlans.splice(idx, 1);
        appendAdminActivityLog(admin, {
            action: "simulation-plan-delete",
            planId: normalized.id,
            assetId: normalized.assetId
        });
        await saveAdminRegistry(admin);
        return { ok: true, deleted: true, plans: admin.simulationPlans };
    }

    if (idx >= 0) {
        admin.simulationPlans[idx] = Object.assign({}, admin.simulationPlans[idx], normalized);
    } else {
        admin.simulationPlans.unshift(normalized);
    }

    appendAdminActivityLog(admin, {
        action: "simulation-plan-upsert",
        planId: normalized.id,
        assetId: normalized.assetId
    });
    await saveAdminRegistry(admin);
    return { ok: true, plan: normalized, plans: admin.simulationPlans };
}

async function saveSimulationSettings(settings, adminCtx) {
    const admin = ensureSimulationAdmin(adminCtx || await loadAdminRegistry());
    const prev = Object.assign({}, admin.simulationSettings);
    admin.simulationSettings = Object.assign({}, admin.simulationSettings, settings || {});
    appendAdminActivityLog(admin, {
        action: "simulation-settings-update",
        before: prev,
        after: admin.simulationSettings
    });
    await saveAdminRegistry(admin);
    return { ok: true, settings: admin.simulationSettings };
}

function attachPlanSnapshot(inv, admin) {
    const plan = (admin.simulationPlans || []).find(function(p) {
        return String(p.id) === String(inv.planId);
    });
    inv._planSnapshot = plan ? Object.assign({}, plan) : null;
    return inv;
}

async function processSimulationCreditForUser(email, options) {
    options = options || {};
    const key = normalizeRegistryEmail(email);
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    if (admin.simulationSettings.enrollmentsPaused && !options.force) {
        return { ok: true, credited: false, skipped: true, reason: "Global enrollments paused." };
    }

    const accounts = await loadAllAccounts();
    let account = accounts[key] ? Object.assign({}, accounts[key]) : null;
    if (!account) return { ok: false, error: "Account not found." };
    account = ensureAccountSimulations(Object.assign({}, account));
    account.simulationInvestments = account.simulationInvestments.map(function(inv) {
        return attachPlanSnapshot(Object.assign({}, inv), admin);
    });

    let creditedCount = 0;
    const results = [];
    const now = Date.now();

    for (let i = 0; i < account.simulationInvestments.length; i++) {
        const inv = account.simulationInvestments[i];
        if (!inv || inv.status !== "active") continue;
        const plan = inv._planSnapshot;
        if (!plan || plan.enabled === false || plan.paused) {
            results.push({ id: inv.id, skipped: true, reason: "Plan inactive." });
            continue;
        }
        if (inv.nextCreditAt && new Date(inv.nextCreditAt).getTime() > now && !options.force) {
            results.push({ id: inv.id, skipped: true, reason: "Not due yet." });
            continue;
        }

        const investedCents = toCents(inv.investedAmount);
        const creditCents = planDailyReturnCents(plan, investedCents);
        if (creditCents <= 0) {
            results.push({ id: inv.id, skipped: true, reason: "Zero credit." });
            continue;
        }

        const reference = "sim-" + inv.id + "-" + now;
        const duplicate = (admin.simulationCreditLog || []).some(function(row) {
            return row.reference === reference;
        });
        if (duplicate) {
            results.push({ id: inv.id, skipped: true, duplicate: true });
            continue;
        }

        inv.totalSimulatedEarned = fromCents(toCents(inv.totalSimulatedEarned) + creditCents);
        inv.lastCreditDate = new Date().toISOString().slice(0, 10);
        inv.nextCreditAt = new Date(now + MS_DAY).toISOString();
        if (!Array.isArray(inv.history)) inv.history = [];
        inv.history.unshift({
            date: new Date().toISOString(),
            amount: fromCents(creditCents),
            reference: reference,
            type: "simulated-credit"
        });
        if (inv.history.length > 200) inv.history = inv.history.slice(0, 200);

        admin.simulationCreditLog.unshift({
            id: "simcr-" + now + "-" + Math.random().toString(36).slice(2, 6),
            reference: reference,
            userEmail: key,
            assetId: inv.assetId,
            planId: inv.planId,
            amount: fromCents(creditCents),
            status: "completed",
            createdAt: new Date().toISOString(),
            notificationStatus: admin.simulationSettings.notifyOnCredit ? "queued-in-app" : "disabled"
        });
        if (admin.simulationCreditLog.length > 1000) {
            admin.simulationCreditLog = admin.simulationCreditLog.slice(0, 1000);
        }

        if (!Array.isArray(account.notifications)) account.notifications = [];
        if (admin.simulationSettings.notifyOnCredit) {
            account.notifications.unshift({
                id: "sim-" + reference,
                title: "Simulated earnings credited",
                message: "Your " + (inv.assetName || inv.assetId) + " simulation credited $" +
                    fromCents(creditCents).toFixed(2) + " (educational simulation only).",
                time: new Date().toISOString(),
                read: false,
                type: "simulation",
                category: "simulation"
            });
            if (account.notifications.length > 30) {
                account.notifications = account.notifications.slice(0, 30);
            }
        }

        creditedCount += 1;
        results.push({ id: inv.id, credited: true, amount: fromCents(creditCents) });
        delete inv._planSnapshot;
        account.simulationInvestments[i] = inv;
    }

    await upsertAccount(key, account, { source: "simulation-credit", simulationAuthoritative: true });
    await saveAdminRegistry(admin);

    return { ok: true, credited: creditedCount > 0, creditedCount: creditedCount, results: results };
}

async function processAllSimulationCredits() {
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    const started = new Date().toISOString();
    const accounts = await loadAllAccounts();
    let credited = 0;
    const errors = [];

    for (const email of Object.keys(accounts)) {
        const key = normalizeRegistryEmail(email);
        const acct = accounts[email];
        if (!acct || !Array.isArray(acct.simulationInvestments) || !acct.simulationInvestments.length) continue;
        try {
            const result = await processSimulationCreditForUser(key);
            if (result.creditedCount) credited += result.creditedCount;
        } catch (err) {
            errors.push({ email: key, error: err.message || String(err) });
        }
    }

    let goldResult = null;
    try {
        goldResult = await processAllDailyCredits();
    } catch (err) {
        errors.push({ scope: "gold", error: err.message || String(err) });
    }

    const job = {
        id: "simjob-" + Date.now(),
        startedAt: started,
        finishedAt: new Date().toISOString(),
        status: errors.length ? "partial" : "completed",
        marketCredits: credited,
        goldCredits: goldResult && goldResult.credited ? goldResult.credited : 0,
        errors: errors
    };
    admin.simulationJobRuns.unshift(job);
    if (admin.simulationJobRuns.length > 100) admin.simulationJobRuns = admin.simulationJobRuns.slice(0, 100);
    await saveAdminRegistry(admin);

    return {
        ok: true,
        job: job,
        marketCredits: credited,
        gold: goldResult,
        errors: errors
    };
}

async function getSimulationHistory(limit) {
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    await ensureAdminGoldPlans(admin);
    const sim = (admin.simulationCreditLog || []).slice(0, limit || 200);
    const gold = (admin.goldPayoutLog || []).slice(0, limit || 200).map(function(row) {
        return Object.assign({}, row, { source: "gold-legacy" });
    });
    const merged = sim.map(function(row) {
        return Object.assign({ source: "market-simulation" }, row);
    }).concat(gold).sort(function(a, b) {
        return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
    });
    return { ok: true, history: merged.slice(0, limit || 200) };
}

async function getMonitoringDashboard() {
    const overview = await getAdminInvestmentOverview();
    const admin = await ensureDefaultSimulationPlans(await loadAdminRegistry());
    return {
        ok: true,
        overview: overview.overview,
        recentJobs: (admin.simulationJobRuns || []).slice(0, 20),
        recentCredits: (admin.simulationCreditLog || []).slice(0, 50),
        notificationLog: (admin.notificationLog || []).slice(0, 50),
        systemHealth: {
            registry: true,
            simulationPlans: (admin.simulationPlans || []).length,
            educationalLabel: admin.simulationSettings.educationalLabel
        }
    };
}

function exportInvestmentsReport(rows) {
    const header = [
        "source",
        "userEmail",
        "userName",
        "assetId",
        "planName",
        "investedAmount",
        "totalSimulatedEarned",
        "dailySimulatedReturn",
        "status",
        "startDate"
    ].join(",");
    const lines = (rows || []).map(function(r) {
        return [
            r.source,
            r.userEmail,
            (r.userName || "").replace(/,/g, " "),
            r.assetId,
            (r.planName || "").replace(/,/g, " "),
            r.investedAmount,
            r.totalSimulatedEarned,
            r.dailySimulatedReturn,
            r.status,
            r.startDate || ""
        ].join(",");
    });
    return header + "\n" + lines.join("\n");
}

module.exports = {
    SIMULATION_ASSETS,
    DEFAULT_SIMULATION_SETTINGS,
    simulatedDailyReturnCents,
    ensureSimulationAdmin,
    ensureDefaultSimulationPlans,
    getAdminInvestmentOverview,
    listAdminInvestments,
    listSimulationPlans,
    upsertSimulationPlan,
    saveSimulationSettings,
    processSimulationCreditForUser,
    processAllSimulationCredits,
    getSimulationHistory,
    getMonitoringDashboard,
    exportInvestmentsReport,
    planDailyReturnCents,
    toCents,
    fromCents
};
