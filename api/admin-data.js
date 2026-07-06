const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const {
    isRegistryConfigured,
    registryConfigError,
    loadAdminRegistry,
    saveAdminRegistry
} = require("../server-lib/registry");

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (!isRegistryConfigured()) {
        res.status(503).json(registryConfigError());
        return;
    }

    try {
        if (req.method === "GET") {
            const admin = await loadAdminRegistry();
            if (!admin) {
                res.status(200).json({ ok: false, error: "Admin registry empty." });
                return;
            }
            res.status(200).json({ ok: true, admin: admin });
            return;
        }

        if (req.method === "PUT" || req.method === "POST") {
            const admin = req.body && req.body.admin;
            const result = await saveAdminRegistry(admin);
            res.status(200).json({ ok: true, email: result.email });
            return;
        }

        res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (err) {
        const message = err && err.message ? err.message : "Admin registry request failed.";
        const status = message.indexOf("Missing or invalid") === 0 ? 400 : 500;
        res.status(status).json({ ok: false, error: message });
    }
};
