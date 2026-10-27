const { loadAdminRegistry, saveAdminRegistry, loadAllAccounts, normalizeRegistryEmail } = require("./registry");
const { sendDepositCreditedEmailSafely } = require("./deposit-emails");

/**
 * Retries credited confirmation emails for approved deposits where the ledger
 * post succeeded but Resend failed. Never mutates balances.
 */
async function processPendingDepositConfirmationEmails(options) {
    options = options || {};
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
    const admin = await loadAdminRegistry();
    if (!admin || !Array.isArray(admin.pendingDeposits)) {
        return { ok: true, attempted: 0, sent: 0, skipped: 0 };
    }

    const accounts = await loadAllAccounts();
    let attempted = 0;
    let sent = 0;
    let skipped = 0;
    let dirty = false;

    for (let i = 0; i < admin.pendingDeposits.length && attempted < limit; i++) {
        const dep = admin.pendingDeposits[i];
        if (!dep || dep.status !== "approved") continue;
        if (dep.approvedEmailSentAt) {
            skipped += 1;
            continue;
        }
        attempted += 1;
        const key = normalizeRegistryEmail(dep.userEmail);
        const account = accounts[key] || null;
        const result = await sendDepositCreditedEmailSafely(dep, account, admin);
        if (result.sent) {
            dep.approvedEmailSentAt = new Date().toISOString();
            dep.creditedEmailLastError = null;
            sent += 1;
            dirty = true;
        } else if (result.error) {
            dep.creditedEmailLastError = String(result.error).slice(0, 500);
            dep.creditedEmailRetryAt = new Date().toISOString();
            dirty = true;
        }
    }

    if (dirty) {
        await saveAdminRegistry(admin);
    }

    return { ok: true, attempted: attempted, sent: sent, skipped: skipped };
}

module.exports = {
    processPendingDepositConfirmationEmails
};
