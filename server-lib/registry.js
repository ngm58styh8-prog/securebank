const { getSupabaseServiceRoleClient, normalizeSupabaseErrorMessage } = require("./supabase");
const {
    sendDepositReceivedEmailSafely,
    sendDepositCreditedEmailSafely,
    sendDepositDeclinedEmailSafely
} = require("./deposit-emails");

const ACCOUNTS_TABLE = "user_accounts";
const ADMIN_TABLE = "admin_registry";
const ADMIN_ROW_ID = "default";

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

const DEFAULT_ADMIN_REGISTRY = {
    email: "admin@globalvest.com",
    password: "admin123",
    balance: 0,
    payments: [],
    pendingTransfers: [],
    pendingDeposits: [],
    walletAddress: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
    bankDetails: "GlobalVest Admin · Routing: 021000021 · Account: 8847291053",
    registeredUsers: {},
    userActivityLog: [],
    notificationLog: [],
    websiteSettings: {
        siteName: "GlobalVest",
        siteTagline: "Global Investing & Digital Banking",
        supportEmail: "support@globalvest.com",
        announcement: "",
        maintenanceMode: false
    }
};

function normalizeRegistryEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function isProtectedAdminRegistryEmail(email) {
    const key = normalizeRegistryEmail(email);
    return key === "admin@globalvest.com" || key === "admin@securebank.com";
}

function isRegistryConfigured() {
    try {
        getSupabaseServiceRoleClient();
        return true;
    } catch (e) {
        return false;
    }
}

function registryConfigError() {
    return {
        ok: false,
        error: "Account registry is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel, then run supabase/migrations/002_app_registry.sql."
    };
}

async function loadAllAccounts() {
    const supabase = getSupabaseServiceRoleClient();
    const { data, error } = await supabase
        .from(ACCOUNTS_TABLE)
        .select("email, account");

    if (error) {
        throw new Error(normalizeSupabaseErrorMessage(error.message || "Failed to load accounts."));
    }

    const accounts = {};
    (data || []).forEach(function(row) {
        const email = normalizeRegistryEmail(row.email);
        if (!email || email.indexOf("@") === -1) return;
        if (row.account && typeof row.account === "object") {
            accounts[email] = row.account;
        }
    });
    return accounts;
}

async function upsertAccount(email, account, options) {
    options = options || {};
    const key = normalizeRegistryEmail(email);
    if (!key || key.indexOf("@") === -1) {
        throw new Error("Missing or invalid email.");
    }
    if (!account || typeof account !== "object") {
        throw new Error("Missing or invalid account payload.");
    }

    const supabase = getSupabaseServiceRoleClient();
    const { data: existing, error: readError } = await supabase
        .from(ACCOUNTS_TABLE)
        .select("account")
        .eq("email", key)
        .maybeSingle();

    if (readError) {
        throw new Error(normalizeSupabaseErrorMessage(readError.message || "Failed to read account."));
    }

    const balanceBefore = existing && existing.account && typeof existing.account.cash === "number"
        ? existing.account.cash
        : null;

    let merged = account;
    if (existing && existing.account && typeof existing.account === "object") {
        merged = Object.assign({}, existing.account, account);
        merged.profile = Object.assign({}, existing.account.profile || {}, account.profile || {});
        merged.settings = Object.assign({}, existing.account.settings || {}, account.settings || {});
        merged.holdings = Object.assign({}, existing.account.holdings || {}, account.holdings || {});
        if (Array.isArray(account.transactions)) {
            merged.transactions = account.transactions;
        }
        if (Array.isArray(account.pendingDeposits)) {
            merged.pendingDeposits = account.pendingDeposits;
        }
        if (Array.isArray(account.notifications) || Array.isArray(existing.account.notifications)) {
            merged.notifications = mergeNotificationLists(
                account.notifications || [],
                existing.account.notifications || []
            );
        }

        const incomingCash = typeof account.cash === "number" && !isNaN(account.cash) ? account.cash : null;
        const existingCash = typeof existing.account.cash === "number" && !isNaN(existing.account.cash)
            ? existing.account.cash
            : null;

        if (incomingCash !== null) {
            if (options.cashAuthoritative) {
                merged.cash = incomingCash;
            } else if (existingCash !== null && incomingCash < existingCash) {
                console.warn("[registry] blocked cash downgrade", {
                    userEmail: key,
                    table: ACCOUNTS_TABLE,
                    column: "account.cash",
                    balanceBefore: existingCash,
                    attemptedBalance: incomingCash,
                    eventType: options.eventType || "sync",
                    source: options.source || "client-sync"
                });
                merged.cash = existingCash;
            } else {
                merged.cash = incomingCash;
            }
        } else if (existingCash !== null) {
            merged.cash = existingCash;
        }
    }

    merged.serverSyncedAt = new Date().toISOString();
    const now = new Date().toISOString();

    const { error } = await supabase
        .from(ACCOUNTS_TABLE)
        .upsert({
            email: key,
            account: merged,
            server_synced_at: now,
            updated_at: now
        }, { onConflict: "email" });

    if (error) {
        throw new Error(normalizeSupabaseErrorMessage(error.message || "Failed to save account."));
    }

    if (typeof merged.cash === "number" && balanceBefore !== null && merged.cash !== balanceBefore) {
        console.log("[registry] balance updated", {
            userEmail: key,
            table: ACCOUNTS_TABLE,
            column: "account.cash",
            balanceBefore: balanceBefore,
            balanceAfter: merged.cash,
            delta: merged.cash - balanceBefore,
            eventType: options.eventType || "sync",
            source: options.source || "upsertAccount"
        });
    }

    return { email: key, account: merged };
}

function ensureAdminRegistryShape(admin) {
    const base = Object.assign({}, DEFAULT_ADMIN_REGISTRY);
    admin = admin && typeof admin === "object" ? admin : {};
    admin = Object.assign(base, admin);
    if (!admin.registeredUsers || typeof admin.registeredUsers !== "object") {
        admin.registeredUsers = {};
    }
    if (!Array.isArray(admin.userActivityLog)) admin.userActivityLog = [];
    if (!Array.isArray(admin.payments)) admin.payments = [];
    if (!Array.isArray(admin.pendingTransfers)) admin.pendingTransfers = [];
    if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];
    if (!Array.isArray(admin.notificationLog)) admin.notificationLog = [];
    if (!Array.isArray(admin.internalTransfers)) admin.internalTransfers = [];
    if (!Array.isArray(admin.sendMoneyAuditLog)) admin.sendMoneyAuditLog = [];
    if (!admin.processedSendMoneyKeys) admin.processedSendMoneyKeys = {};
    return admin;
}

async function ensureAdminRegistry() {
    const existing = await loadAdminRegistry();
    return ensureAdminRegistryShape(existing);
}

async function linkAccountToAdminRegistry(email, account, options) {
    options = options || {};
    const key = normalizeRegistryEmail(email);
    if (!key || key.indexOf("@") === -1) {
        throw new Error("Missing or invalid email.");
    }
    if (!account || typeof account !== "object") {
        throw new Error("Missing or invalid account payload.");
    }

    const admin = await ensureAdminRegistry();
    const profile = account.profile || {};
    const userName = profile.fullName || key;
    const now = new Date().toISOString();
    const existing = admin.registeredUsers[key];
    const isNew = !existing;

    admin.registeredUsers[key] = {
        email: key,
        name: userName,
        phone: profile.phone || "",
        memberSince: profile.memberSince || null,
        lastLoginAt: profile.lastLoginAt || null,
        lastLoginDevice: profile.lastLoginDevice || null,
        emailVerified: !!account.emailVerified,
        verificationStatus: profile.verificationStatus || "Pending",
        withdrawalsFrozen: !!account.withdrawalsFrozen,
        linkedAt: existing && existing.linkedAt ? existing.linkedAt : now,
        updatedAt: now
    };

    const shouldLogSignup = options.eventType === "signup" || (isNew && options.logSignup !== false);
    if (shouldLogSignup) {
        const hasSignup = admin.userActivityLog.some(function(entry) {
            return entry.type === "signup" &&
                normalizeRegistryEmail(entry.userEmail) === key;
        });
        if (!hasSignup) {
            admin.userActivityLog.unshift({
                id: Date.now() + Math.random(),
                date: profile.memberSince
                    ? new Date(profile.memberSince).toLocaleString()
                    : new Date().toLocaleString(),
                userEmail: key,
                userName: userName,
                type: "signup",
                description: isNew ? "New account registered" : "Account linked to admin dashboard",
                amount: 0
            });
        }
    }

    if (options.eventType === "login") {
        admin.userActivityLog.unshift({
            id: Date.now() + Math.random(),
            date: new Date().toLocaleString(),
            userEmail: key,
            userName: userName,
            type: "login",
            description: "Signed in from " + (profile.lastLoginDevice || "web"),
            amount: 0
        });
    }

    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }

    await saveAdminRegistry(admin);
    return { email: key, linked: true, isNew: isNew };
}

async function registerUserAccount(email, account, options) {
    options = options || {};
    const cashAuthoritative = options.eventType === "deposit-approve" ||
        options.eventType === "admin-adjust";
    const result = await upsertAccount(email, account, {
        eventType: options.eventType || "signup",
        cashAuthoritative: cashAuthoritative,
        source: options.source || "registerUserAccount"
    });
    const link = await linkAccountToAdminRegistry(result.email, result.account, options || { eventType: "signup" });
    return {
        email: result.email,
        account: result.account,
        adminLinked: true,
        isNew: link.isNew
    };
}

async function unlinkAccountFromAdminRegistry(email) {
    const key = normalizeRegistryEmail(email);
    const admin = await ensureAdminRegistry();
    if (admin.registeredUsers[key]) {
        delete admin.registeredUsers[key];
        await saveAdminRegistry(admin);
    }
    return { email: key, unlinked: true };
}

async function deleteAccount(email) {
    const key = normalizeRegistryEmail(email);
    if (!key || key.indexOf("@") === -1) {
        throw new Error("Missing or invalid email.");
    }
    if (isProtectedAdminRegistryEmail(key)) {
        throw new Error("The admin account cannot be deleted.");
    }

    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase
        .from(ACCOUNTS_TABLE)
        .delete()
        .eq("email", key);

    if (error) {
        throw new Error(error.message || "Failed to delete account.");
    }

    await unlinkAccountFromAdminRegistry(key);

    return { email: key, deleted: true };
}

async function loadAdminRegistry() {
    const supabase = getSupabaseServiceRoleClient();
    const { data, error } = await supabase
        .from(ADMIN_TABLE)
        .select("admin")
        .eq("id", ADMIN_ROW_ID)
        .maybeSingle();

    if (error) {
        throw new Error(normalizeSupabaseErrorMessage(error.message || "Failed to load admin registry."));
    }

    if (!data || !data.admin || typeof data.admin !== "object" || !data.admin.email) {
        return null;
    }
    return data.admin;
}

async function saveAdminRegistry(admin) {
    if (!admin || typeof admin !== "object" || !admin.email) {
        throw new Error("Missing or invalid admin payload.");
    }

    admin.serverSyncedAt = new Date().toISOString();
    const now = new Date().toISOString();

    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase
        .from(ADMIN_TABLE)
        .upsert({
            id: ADMIN_ROW_ID,
            admin: admin,
            server_synced_at: now,
            updated_at: now
        }, { onConflict: "id" });

    if (error) {
        throw new Error(normalizeSupabaseErrorMessage(error.message || "Failed to save admin registry."));
    }

    return { email: admin.email };
}

function normalizePendingDeposit(deposit) {
    if (!deposit || typeof deposit !== "object") {
        throw new Error("Missing or invalid deposit payload.");
    }

    const key = normalizeRegistryEmail(deposit.userEmail);
    if (!key || key.indexOf("@") === -1) {
        throw new Error("Missing or invalid user email.");
    }

    const amount = Number(deposit.amount);
    if (!amount || amount <= 0 || isNaN(amount)) {
        throw new Error("Missing or invalid deposit amount.");
    }

    return {
        id: String(deposit.id || ("dep-" + Date.now())),
        userEmail: key,
        userName: String(deposit.userName || key),
        amount: amount,
        btcAmount: deposit.btcAmount != null ? Number(deposit.btcAmount) : null,
        method: deposit.method || "crypto",
        payTo: String(deposit.payTo || ""),
        status: deposit.status || "pending",
        requestedAt: deposit.requestedAt || new Date().toISOString(),
        date: deposit.date || new Date().toLocaleString()
    };
}

async function mirrorPendingDepositOnUserAccount(deposit) {
    const key = normalizeRegistryEmail(deposit.userEmail);
    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) {
        console.warn("[registry] mirrorPendingDeposit skipped — account not found", { userEmail: key });
        return null;
    }

    const pendingDeposits = Array.isArray(account.pendingDeposits) ? account.pendingDeposits.slice() : [];
    const exists = pendingDeposits.some(function(entry) {
        return String(entry.id) === String(deposit.id);
    });
    if (!exists) {
        pendingDeposits.push({
            id: deposit.id,
            amount: deposit.amount,
            btcAmount: deposit.btcAmount,
            method: deposit.method,
            payTo: deposit.payTo,
            status: "pending",
            date: deposit.date
        });
    }

    const updated = Object.assign({}, account, { pendingDeposits: pendingDeposits });
    const saved = await upsertAccount(key, updated, {
        eventType: "deposit-submit",
        source: "mirrorPendingDepositOnUserAccount"
    });
    return saved.account;
}

function getPendingDepositsFromAdmin(admin) {
    if (!admin || !Array.isArray(admin.pendingDeposits)) return [];
    return admin.pendingDeposits.filter(function(entry) {
        return entry && (!entry.status || entry.status === "pending");
    });
}

async function appendPendingDeposit(deposit) {
    const normalized = normalizePendingDeposit(deposit);
    const admin = await ensureAdminRegistry();
    if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];

    const duplicate = admin.pendingDeposits.find(function(entry) {
        return String(entry.id) === String(normalized.id);
    });
    if (duplicate) {
        let account = null;
        try {
            account = await mirrorPendingDepositOnUserAccount(duplicate);
        } catch (mirrorErr) {
            console.error("[registry] appendPendingDeposit duplicate mirror failed:", mirrorErr.message || mirrorErr);
        }
        return {
            ok: true,
            duplicate: true,
            deposit: duplicate,
            pendingCount: getPendingDepositsFromAdmin(admin).length,
            pendingDeposits: getPendingDepositsFromAdmin(admin),
            account: account,
            emailSent: !!duplicate.submittedEmailSentAt
        };
    }

    admin.pendingDeposits.unshift(normalized);
    ensureAdminRegistryShape(admin);
    admin.userActivityLog.unshift({
        id: Date.now() + Math.random(),
        date: normalized.date,
        userEmail: normalized.userEmail,
        userName: normalized.userName,
        type: "deposit",
        description: "Deposit request submitted — " + normalized.method,
        amount: normalized.amount
    });
    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }

    await saveAdminRegistry(admin);

    let account = null;
    try {
        account = await mirrorPendingDepositOnUserAccount(normalized);
    } catch (mirrorErr) {
        console.error("[registry] appendPendingDeposit account mirror failed:", mirrorErr.message || mirrorErr);
        try {
            const accounts = await loadAllAccounts();
            account = accounts[normalized.userEmail] || null;
        } catch (loadErr) {
            console.error("[registry] appendPendingDeposit account load failed:", loadErr.message || loadErr);
        }
    }

    const emailResult = await sendDepositReceivedEmailSafely(normalized, account, admin);
    if (emailResult.sent) {
        normalized.submittedEmailSentAt = new Date().toISOString();
        const entry = admin.pendingDeposits.find(function(item) {
            return String(item.id) === String(normalized.id);
        });
        if (entry) {
            entry.submittedEmailSentAt = normalized.submittedEmailSentAt;
            await saveAdminRegistry(admin);
        }
    }

    return {
        ok: true,
        deposit: normalized,
        pendingCount: getPendingDepositsFromAdmin(admin).length,
        pendingDeposits: getPendingDepositsFromAdmin(admin),
        account: account,
        duplicate: false,
        emailSent: !!emailResult.sent,
        emailSkipped: !!emailResult.skipped,
        emailError: emailResult.error || null
    };
}

function findPendingDepositInAdmin(admin, depositId) {
    if (!admin || !Array.isArray(admin.pendingDeposits)) return null;
    return admin.pendingDeposits.find(function(entry) {
        return String(entry.id) === String(depositId);
    }) || null;
}

function recordAdminDepositPayment(admin, deposit) {
    admin.balance = (admin.balance || 0) + deposit.amount;
    admin.payments = admin.payments || [];
    admin.payments.unshift({
        id: Date.now() + Math.random(),
        userEmail: deposit.userEmail,
        userName: deposit.userName || deposit.userEmail,
        type: "deposit",
        amount: deposit.amount,
        method: deposit.method || "crypto",
        date: new Date().toLocaleString()
    });
}

async function approvePendingDeposit(depositId) {
    const admin = await ensureAdminRegistry();
    const deposit = findPendingDepositInAdmin(admin, depositId);
    if (!deposit) {
        throw new Error("Deposit request not found.");
    }
    if (deposit.status && deposit.status !== "pending") {
        return {
            ok: true,
            alreadyResolved: true,
            status: deposit.status,
            email: deposit.userEmail,
            emailSent: !!(deposit.approvedEmailSentAt || deposit.rejectedEmailSentAt)
        };
    }

    const key = normalizeRegistryEmail(deposit.userEmail);
    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) {
        throw new Error("User account not found.");
    }

    const balanceBefore = Number(account.cash || 0);
    const depositAmount = Number(deposit.amount);
    const balanceAfter = balanceBefore + depositAmount;

    console.log("[registry] deposit approval started", {
        userEmail: key,
        depositId: deposit.id,
        balanceBefore: balanceBefore,
        depositAmount: depositAmount,
        balanceAfter: balanceAfter,
        table: ACCOUNTS_TABLE
    });

    const updatedAccount = Object.assign({}, account);
    updatedAccount.cash = balanceAfter;
    updatedAccount.transactions = Array.isArray(account.transactions) ? account.transactions.slice() : [];
    updatedAccount.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Deposit Approved (" + deposit.method + ") — paid to admin",
        amount: depositAmount
    });
    if (Array.isArray(updatedAccount.pendingDeposits)) {
        updatedAccount.pendingDeposits = updatedAccount.pendingDeposits.filter(function(item) {
            return String(item.id) !== String(depositId);
        });
    }
    updatedAccount.notifications = Array.isArray(account.notifications) ? account.notifications.slice() : [];
    updatedAccount.notifications.unshift({
        id: Date.now() + Math.random(),
        message: "Deposit of $" + depositAmount.toFixed(2) + " was approved and credited to your balance",
        time: new Date().toISOString(),
        read: false,
        type: "deposit"
    });
    if (updatedAccount.notifications.length > 30) {
        updatedAccount.notifications = updatedAccount.notifications.slice(0, 30);
    }

    let saved;
    try {
        saved = await upsertAccount(key, updatedAccount, {
            cashAuthoritative: true,
            eventType: "deposit-approve",
            source: "approvePendingDeposit"
        });
    } catch (err) {
        console.error("[registry] deposit approval balance update failed", {
            userEmail: key,
            depositId: deposit.id,
            balanceBefore: balanceBefore,
            depositAmount: depositAmount,
            error: err && err.message ? err.message : String(err)
        });
        throw err;
    }

    deposit.status = "approved";
    deposit.resolvedAt = new Date().toISOString();
    recordAdminDepositPayment(admin, deposit);

    admin.userActivityLog.unshift({
        id: Date.now() + Math.random(),
        date: deposit.resolvedAt,
        userEmail: deposit.userEmail,
        userName: deposit.userName || deposit.userEmail,
        type: "deposit",
        description: "Deposit approved and credited",
        amount: depositAmount
    });
    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }

    try {
        await saveAdminRegistry(admin);
    } catch (err) {
        console.error("[registry] deposit approval admin save failed — rolling back balance", {
            userEmail: key,
            depositId: deposit.id,
            balanceBefore: balanceBefore,
            error: err && err.message ? err.message : String(err)
        });
        const rollbackAccount = Object.assign({}, account);
        rollbackAccount.transactions = Array.isArray(account.transactions) ? account.transactions.slice() : [];
        await upsertAccount(key, rollbackAccount, {
            cashAuthoritative: true,
            eventType: "deposit-approve-rollback",
            source: "approvePendingDeposit"
        });
        throw err;
    }

    console.log("[registry] deposit approved", {
        userEmail: key,
        depositId: deposit.id,
        balanceBefore: balanceBefore,
        depositAmount: depositAmount,
        balanceAfter: saved.account.cash,
        table: ACCOUNTS_TABLE,
        column: "account.cash"
    });

    const emailResult = await sendDepositCreditedEmailSafely(deposit, saved.account, admin);
    if (emailResult.sent) {
        deposit.approvedEmailSentAt = new Date().toISOString();
        await saveAdminRegistry(admin);
    }

    return {
        ok: true,
        email: key,
        account: saved.account,
        amount: depositAmount,
        method: deposit.method,
        depositId: deposit.id,
        balanceBefore: balanceBefore,
        balanceAfter: saved.account.cash,
        emailSent: !!emailResult.sent,
        emailSkipped: !!emailResult.skipped,
        emailError: emailResult.error || null
    };
}

async function rejectPendingDeposit(depositId, reason) {
    const admin = await ensureAdminRegistry();
    const deposit = findPendingDepositInAdmin(admin, depositId);
    if (!deposit) {
        throw new Error("Deposit request not found.");
    }
    if (deposit.status && deposit.status !== "pending") {
        return {
            ok: true,
            alreadyResolved: true,
            status: deposit.status,
            email: deposit.userEmail,
            emailSent: !!(deposit.approvedEmailSentAt || deposit.rejectedEmailSentAt)
        };
    }

    const key = normalizeRegistryEmail(deposit.userEmail);
    const rejectionReason = String(reason || "Rejected by admin").trim() || "Rejected by admin";

    deposit.status = "rejected";
    deposit.resolvedAt = new Date().toISOString();
    deposit.rejectReason = rejectionReason;

    let account = null;
    try {
        const accounts = await loadAllAccounts();
        account = accounts[key] || null;
    } catch (loadErr) {
        console.error("[registry] rejectPendingDeposit account load failed:", loadErr.message || loadErr);
    }

    if (account) {
        account.transactions = Array.isArray(account.transactions) ? account.transactions : [];
        account.transactions.unshift({
            date: new Date().toLocaleString(),
            description: "Deposit Rejected (" + deposit.method + ")",
            amount: 0
        });
        if (Array.isArray(account.pendingDeposits)) {
            account.pendingDeposits = account.pendingDeposits.filter(function(item) {
                return String(item.id) !== String(depositId);
            });
        }
        account.notifications = Array.isArray(account.notifications) ? account.notifications : [];
        account.notifications.unshift({
            id: Date.now() + Math.random(),
            message: "Deposit of $" + Number(deposit.amount).toFixed(2) + " was rejected" +
                (rejectionReason ? ": " + rejectionReason : ""),
            time: new Date().toISOString(),
            read: false,
            type: "deposit"
        });
        if (account.notifications.length > 30) {
            account.notifications = account.notifications.slice(0, 30);
        }
        account = (await upsertAccount(key, account)).account;
    }

    admin.userActivityLog.unshift({
        id: Date.now() + Math.random(),
        date: deposit.resolvedAt,
        userEmail: deposit.userEmail,
        userName: deposit.userName || deposit.userEmail,
        type: "deposit",
        description: "Deposit rejected" + (rejectionReason ? ": " + rejectionReason : ""),
        amount: deposit.amount
    });
    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }

    await saveAdminRegistry(admin);

    const emailResult = await sendDepositDeclinedEmailSafely(deposit, account, admin, rejectionReason);
    if (emailResult.sent) {
        deposit.rejectedEmailSentAt = new Date().toISOString();
        await saveAdminRegistry(admin);
    }

    return {
        ok: true,
        email: key,
        account: account,
        amount: deposit.amount,
        method: deposit.method,
        reason: rejectionReason,
        depositId: deposit.id,
        emailSent: !!emailResult.sent,
        emailSkipped: !!emailResult.skipped,
        emailError: emailResult.error || null
    };
}

module.exports = {
    normalizeRegistryEmail,
    isRegistryConfigured,
    registryConfigError,
    loadAllAccounts,
    upsertAccount,
    registerUserAccount,
    linkAccountToAdminRegistry,
    deleteAccount,
    loadAdminRegistry,
    saveAdminRegistry,
    appendPendingDeposit,
    approvePendingDeposit,
    rejectPendingDeposit
};
