const { getSupabaseServiceRoleClient } = require("./supabase");

const ACCOUNTS_TABLE = "user_accounts";
const ADMIN_TABLE = "admin_registry";
const ADMIN_ROW_ID = "default";

function normalizeRegistryEmail(email) {
    return String(email || "").trim().toLowerCase();
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

async function deleteAccount(email) {
    const key = normalizeRegistryEmail(email);
    if (!key || key.indexOf("@") === -1) {
        throw new Error("Missing or invalid email.");
    }

    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase
        .from(ACCOUNTS_TABLE)
        .delete()
        .eq("email", key);

    if (error) {
        throw new Error(error.message || "Failed to delete account.");
    }

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

module.exports = {
    normalizeRegistryEmail,
    isRegistryConfigured,
    registryConfigError,
    loadAllAccounts,
    upsertAccount,
    deleteAccount,
    loadAdminRegistry,
    saveAdminRegistry
};
