const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const {
    isRegistryConfigured,
    registryConfigError
} = require("../server-lib/registry");
const {
    lookupRecipient,
    executeInternalTransfer,
    reverseInternalTransfer,
    getTransferHistoryForUser,
    calculateTransferFee,
    getBalanceForCurrency,
    ensureGvWallet,
    SUPPORTED_CURRENCIES
} = require("../server-lib/send-money");
const { normalizeRegistryEmail, loadAllAccounts } = require("../server-lib/registry");

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (!isRegistryConfigured()) {
        res.status(503).json(registryConfigError());
        return;
    }

    try {
        if (req.method === "GET") {
            const query = req.query || {};
            const action = query.action;

            if (action === "history") {
                const email = normalizeRegistryEmail(query.email);
                const result = await getTransferHistoryForUser(email, {
                    status: query.status,
                    period: query.period
                });
                res.status(200).json(result);
                return;
            }

            if (action === "balance") {
                const email = normalizeRegistryEmail(query.email);
                const currency = String(query.currency || "USD").toUpperCase();
                const accounts = await loadAllAccounts();
                const account = accounts[email];
                if (!account) {
                    res.status(404).json({ ok: false, error: "Account not found." });
                    return;
                }
                const balance = getBalanceForCurrency(account, currency);
                const fee = calculateTransferFee(Number(query.amount) || 0, currency);
                res.status(200).json({
                    ok: true,
                    currency: currency,
                    balance: balance,
                    walletAddress: ensureGvWallet(account, email),
                    estimatedFee: fee,
                    currencies: SUPPORTED_CURRENCIES
                });
                return;
            }

            if (action === "admin-transfers") {
                const { loadAdminRegistry } = require("../server-lib/registry");
                const admin = await loadAdminRegistry();
                res.status(200).json({
                    ok: true,
                    transfers: admin.internalTransfers || [],
                    auditLog: admin.sendMoneyAuditLog || []
                });
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid GET action." });
            return;
        }

        if (req.method === "POST") {
            const body = req.body || {};

            if (body.action === "lookup") {
                const result = await lookupRecipient(body.recipient || body.query);
                res.status(200).json(result);
                return;
            }

            if (body.action === "send") {
                const result = await executeInternalTransfer({
                    senderEmail: body.senderEmail,
                    recipient: body.recipient,
                    currency: body.currency,
                    amount: body.amount,
                    note: body.note,
                    ipAddress: body.ipAddress,
                    deviceInfo: body.deviceInfo,
                    idempotencyKey: body.idempotencyKey
                });
                const status = result.ok ? 200 : 400;
                res.status(status).json(result);
                return;
            }

            if (body.action === "reverse" && body.transferId) {
                const result = await reverseInternalTransfer(
                    body.transferId,
                    body.adminId || "admin",
                    body.reason
                );
                const status = result.ok ? 200 : 400;
                res.status(status).json(result);
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid POST action." });
            return;
        }

        res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (err) {
        const message = err && err.message ? err.message : "Send money request failed.";
        res.status(500).json({ ok: false, error: message });
    }
};
