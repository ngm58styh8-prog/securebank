/**
 * Load project environment variables for local Node scripts and diagnostics.
 * Priority: .env.local → .env → .vercel/.env.development.local → .vercel/.env.local
 */
const fs = require("fs");
const path = require("path");

function cleanEnvValue(value) {
    let val = String(value || "").trim();
    if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
    ) {
        val = val.slice(1, -1).trim();
    }
    return val;
}

function loadEnvFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    fs.readFileSync(filePath, "utf8").split("\n").forEach(function(line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const idx = trimmed.indexOf("=");
        if (idx === -1) return;
        const key = trimmed.slice(0, idx).trim();
        const val = cleanEnvValue(trimmed.slice(idx + 1));
        if (key && process.env[key] == null) {
            process.env[key] = val;
        }
    });
    return true;
}

function getProjectRoot() {
    return path.join(__dirname, "..");
}

function loadProjectEnv(root) {
    root = root || getProjectRoot();
    const loaded = [];
    const candidates = [
        path.join(root, ".env.local"),
        path.join(root, ".env"),
        path.join(root, ".vercel", ".env.development.local"),
        path.join(root, ".vercel", ".env.local")
    ];
    candidates.forEach(function(filePath) {
        if (loadEnvFile(filePath)) loaded.push(path.basename(path.dirname(filePath)) + "/" + path.basename(filePath));
    });
    return loaded;
}

function isPlaceholderValue(key, value) {
    const val = cleanEnvValue(value);
    if (!val) return true;
    const lower = val.toLowerCase();
    if (val.endsWith("...")) return true;
    if (lower.indexOf("your-project") !== -1) return true;
    if (lower.indexOf("your_") !== -1) return true;
    if (lower.indexOf("re_your_") !== -1) return true;
    if (key === "SUPABASE_URL") {
        return !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(val.replace(/\/$/, ""));
    }
    if (key === "SUPABASE_SERVICE_ROLE_KEY") {
        if (val.startsWith("sb_secret_") && val.length > 20) return false;
        if (val.startsWith("eyJ") && val.length > 120) return false;
        return true;
    }
    return false;
}

function getEnvSetupStatus(root) {
    root = root || getProjectRoot();
    const envLocalPath = path.join(root, ".env.local");
    const examplePath = path.join(root, ".env.example");
    const loadedFrom = loadProjectEnv(root);
    const url = cleanEnvValue(process.env.SUPABASE_URL);
    const key = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

    return {
        envLocalExists: fs.existsSync(envLocalPath),
        exampleExists: fs.existsSync(examplePath),
        loadedFrom: loadedFrom,
        supabaseUrlSet: !!url && !isPlaceholderValue("SUPABASE_URL", url),
        serviceRoleSet: !!key && !isPlaceholderValue("SUPABASE_SERVICE_ROLE_KEY", key),
        ready: !!url && !!key &&
            !isPlaceholderValue("SUPABASE_URL", url) &&
            !isPlaceholderValue("SUPABASE_SERVICE_ROLE_KEY", key)
    };
}

module.exports = {
    cleanEnvValue,
    loadEnvFile,
    loadProjectEnv,
    getProjectRoot,
    isPlaceholderValue,
    getEnvSetupStatus
};
