const { setRegistryCors, handleRegistryOptions } = require("./lib/registry-cors");
const {
    isRegistryConfigured,
    registryConfigError,
    normalizeRegistryEmail,
    loadAllAccounts,
    upsertAccount,
    deleteAccount
} = require("./lib/registry");

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (!isRegistryConfigured()) {
        res.status(503).json(registryConfigError());
        return;
    }

    try {
        if (req.method === "GET") {
            const accounts = await loadAllAccounts();
            res.status(200).json({
                ok: true,
                accounts: accounts,
                count: Object.keys(accounts).length
            });
            return;
        }

        if (req.method === "DELETE") {
            const email = normalizeRegistryEmail(req.body && req.body.email);
            const result = await deleteAccount(email);
            const accounts = await loadAllAccounts();
            res.status(200).json({
                ok: true,
                email: result.email,
                deleted: true,
                count: Object.keys(accounts).length
            });
            return;
        }

        if (req.method === "PUT" || req.method === "POST") {
            const email = normalizeRegistryEmail(req.body && req.body.email);
            const account = req.body && req.body.account;
            const result = await upsertAccount(email, account);
            const accounts = await loadAllAccounts();
            res.status(200).json({
                ok: true,
                email: result.email,
                count: Object.keys(accounts).length
            });
            return;
        }

        res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (err) {
        const message = err && err.message ? err.message : "Registry request failed.";
        const status = message.indexOf("Missing or invalid") === 0 ? 400 : 500;
        res.status(status).json({ ok: false, error: message });
    }
};
