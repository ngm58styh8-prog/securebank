const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ACCOUNTS_PATH = path.join(ROOT, "data", "accounts.json");
const ADMIN_PATH = path.join(ROOT, "data", "admin.json");

function ensureDataDir() {
    const dir = path.dirname(ACCOUNTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeRegistryEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function readJson(filePath, fallback) {
    ensureDataDir();
    if (!fs.existsSync(filePath)) return fallback;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return data == null ? fallback : data;
    } catch (err) {
        console.warn("[local-registry] invalid JSON:", filePath, err.message || err);
        return fallback;
    }
}

function writeJson(filePath, data) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadAllAccounts() {
    const raw = readJson(ACCOUNTS_PATH, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

    const accounts = {};
    Object.keys(raw).forEach(function(key) {
        const email = normalizeRegistryEmail(key);
        const entry = raw[key];
        if (!email || email.indexOf("@") === -1 || !entry || typeof entry !== "object") return;
        accounts[email] = entry;
    });
    return accounts;
}

function saveAllAccounts(accounts) {
    writeJson(ACCOUNTS_PATH, accounts || {});
}

function readExistingAccount(key) {
    const accounts = loadAllAccounts();
    const account = accounts[key];
    return account ? { account: account } : null;
}

function writeAccount(key, merged) {
    const accounts = loadAllAccounts();
    accounts[key] = merged;
    saveAllAccounts(accounts);
    return { email: key, account: merged };
}

function loadAdminRegistry() {
    const admin = readJson(ADMIN_PATH, null);
    if (!admin || typeof admin !== "object" || !admin.email) return null;
    return admin;
}

function saveAdminRegistry(admin) {
    if (!admin || typeof admin !== "object" || !admin.email) {
        throw new Error("Missing or invalid admin payload.");
    }
    admin.serverSyncedAt = new Date().toISOString();
    writeJson(ADMIN_PATH, admin);
    return { email: admin.email };
}

function isLocalRegistryReady() {
    ensureDataDir();
    return true;
}

module.exports = {
    ACCOUNTS_PATH,
    ADMIN_PATH,
    normalizeRegistryEmail,
    loadAllAccounts,
    saveAllAccounts,
    readExistingAccount,
    writeAccount,
    loadAdminRegistry,
    saveAdminRegistry,
    isLocalRegistryReady
};
