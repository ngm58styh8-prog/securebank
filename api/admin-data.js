const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const {
    isRegistryConfigured,
    registryConfigError,
    loadAdminRegistry,
    saveAdminRegistry,
    appendPendingDeposit,
    approvePendingDeposit,
    rejectPendingDeposit,
    appendPendingTransfer,
    approvePendingTransfer,
    rejectPendingTransfer
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

        if (req.method === "POST") {
            const body = req.body || {};
            if (body.action === "append-deposit" && body.deposit) {
                const result = await appendPendingDeposit(body.deposit, {
                    skipEmail: !!body.skipEmail
                });
                res.status(200).json({
                    ok: true,
                    deposit: result.deposit,
                    pendingCount: result.pendingCount,
                    pendingDeposits: result.pendingDeposits || [],
                    account: result.account || null,
                    duplicate: !!result.duplicate,
                    emailSent: !!result.emailSent,
                    emailSkipped: !!result.emailSkipped,
                    emailError: result.emailError || null
                });
                return;
            }

            if (body.action === "approve-deposit" && body.depositId) {
                const result = await approvePendingDeposit(body.depositId);
                res.status(200).json(result);
                return;
            }

            if (body.action === "reject-deposit" && body.depositId) {
                const result = await rejectPendingDeposit(body.depositId, body.reason);
                res.status(200).json(result);
                return;
            }

            if (body.action === "append-transfer" && body.transfer) {
                const result = await appendPendingTransfer(body.transfer);
                res.status(200).json({
                    ok: true,
                    transfer: result.transfer,
                    pendingCount: result.pendingCount,
                    pendingTransfers: result.pendingTransfers || [],
                    account: result.account || null,
                    duplicate: !!result.duplicate,
                    emailSent: !!result.emailSent,
                    emailSkipped: !!result.emailSkipped,
                    emailError: result.emailError || null
                });
                return;
            }

            if (body.action === "approve-transfer" && body.transferId) {
                const result = await approvePendingTransfer(body.transferId);
                res.status(200).json(result);
                return;
            }

            if (body.action === "reject-transfer" && body.transferId) {
                const result = await rejectPendingTransfer(body.transferId, body.reason);
                res.status(200).json(result);
                return;
            }

            if (body.admin) {
                const result = await saveAdminRegistry(body.admin);
                res.status(200).json({ ok: true, email: result.email });
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid POST payload." });
            return;
        }

        if (req.method === "PUT") {
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
