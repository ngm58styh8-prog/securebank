const { loadAdminRegistry, normalizeRegistryEmail } = require("./registry");

function normalizeEmail(email) {
    return normalizeRegistryEmail(email);
}

/**
 * Server-side admin authorization for investment management APIs.
 * Accepts X-Admin-Api-Secret (Vercel env) or admin email + password from an authenticated admin session.
 */
async function assertAdminAuthorized(req, credentials) {
    credentials = credentials || {};
    const headerSecret = req && req.headers
        ? (req.headers["x-admin-api-secret"] || req.headers["X-Admin-Api-Secret"])
        : null;
    const envSecret = process.env.ADMIN_API_SECRET;
    if (envSecret && headerSecret && String(headerSecret) === String(envSecret)) {
        return loadAdminRegistry();
    }

    const email = normalizeEmail(
        credentials.adminEmail || credentials.email || (req && req.query && req.query.adminEmail)
    );
    const password = String(
        credentials.adminPassword ||
        credentials.password ||
        (req && req.query && req.query.adminPassword) ||
        ""
    );

    if (!email || !password) {
        const err = new Error("Admin authorization required.");
        err.statusCode = 401;
        throw err;
    }

    const admin = await loadAdminRegistry();
    if (!admin) {
        const err = new Error("Admin registry unavailable.");
        err.statusCode = 503;
        throw err;
    }

    const validEmail =
        email === normalizeEmail(admin.email) ||
        email === "admin@securebank.com";
    if (!validEmail || String(admin.password) !== password) {
        const err = new Error("Invalid admin credentials.");
        err.statusCode = 403;
        throw err;
    }

    return admin;
}

function appendAdminActivityLog(admin, entry) {
    if (!admin) return;
    if (!Array.isArray(admin.userActivityLog)) admin.userActivityLog = [];
    admin.userActivityLog.unshift(Object.assign({
        id: "act-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString(),
        actor: "admin"
    }, entry || {}));
    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }
}

module.exports = {
    assertAdminAuthorized,
    appendAdminActivityLog
};
