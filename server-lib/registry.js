const { getSupabaseServiceRoleClient } = require("./supabase");

const ACCOUNTS_TABLE = "user_accounts";
const ADMIN_TABLE = "admin_registry";
const ADMIN_ROW_ID = "default";

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
        throw new Error(error.message || "Failed to load accounts.");
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

async function upsertAccount(email, account) {
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
        throw new Error(readError.message || "Failed to read account.");
    }

    let merged = account;
    if (existing && existing.account && typeof existing.account === "object") {
        merged = Object.assign({}, existing.account, account);
        merged.profile = Object.assign({}, existing.account.profile || {}, account.profile || {});
        merged.settings = Object.assign({}, existing.account.settings || {}, account.settings || {});
        merged.holdings = Object.assign({}, existing.account.holdings || {}, account.holdings || {});
        if (Array.isArray(account.transactions)) {
            merged.transactions = account.transactions;
        }
        if (typeof account.cash === "number" && !isNaN(account.cash)) {
            merged.cash = account.cash;
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
        throw new Error(error.message || "Failed to save account.");
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
    const result = await upsertAccount(email, account);
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
        throw new Error(error.message || "Failed to load admin registry.");
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
        throw new Error(error.message || "Failed to save admin registry.");
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

async function appendPendingDeposit(deposit) {
    const normalized = normalizePendingDeposit(deposit);
    const admin = await ensureAdminRegistry();
    if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];

    const duplicate = admin.pendingDeposits.find(function(entry) {
        return String(entry.id) === String(normalized.id);
    });
    if (duplicate) {
        return { ok: true, duplicate: true, deposit: duplicate };
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
    return { ok: true, deposit: normalized, pendingCount: admin.pendingDeposits.length };
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
    appendPendingDeposit
};
