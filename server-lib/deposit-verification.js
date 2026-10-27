const { validateWalletAddress, isDemoWalletAddress } = require("./crypto-deposit-config");

const VERIFIED_STATUSES = [
    "verified_on_chain",
    "verified_provider",
    "verified_reconciliation"
];

function normalizeTxHash(hash) {
    return String(hash || "").trim();
}

function isDepositPaymentVerified(deposit) {
    if (!deposit || typeof deposit !== "object") return false;
    if (deposit.paymentVerifiedAt) return true;
    const status = String(deposit.verificationStatus || "").toLowerCase();
    return VERIFIED_STATUSES.indexOf(status) !== -1;
}

function verificationStatusLabel(deposit) {
    if (!deposit) return "Unverified";
    if (isDepositPaymentVerified(deposit)) {
        const status = String(deposit.verificationStatus || "verified_reconciliation");
        if (status === "verified_on_chain") return "Verified (on-chain)";
        if (status === "verified_provider") return "Verified (payment provider)";
        return "Verified (reconciliation)";
    }
    return "Unverified — approval blocked";
}

function assertCanApproveDeposit(deposit) {
    if (!deposit) throw new Error("Deposit request not found.");
    if (deposit.status && deposit.status !== "pending") {
        return { alreadyResolved: true, status: deposit.status };
    }
    if (!isDepositPaymentVerified(deposit)) {
        throw new Error(
            "Payment is not verified. Confirm on-chain or provider evidence before approving."
        );
    }
    const currency = String(deposit.currency || "BTC").toUpperCase();
    const wallet = String(deposit.walletAddress || deposit.payTo || "").trim();
    if (!wallet || !validateWalletAddress(currency, wallet)) {
        throw new Error("Invalid or unsupported wallet address for " + currency + ".");
    }
    if (isDemoWalletAddress(wallet)) {
        throw new Error("Demo deposit addresses cannot be approved for real credits.");
    }
    return null;
}

function buildVerificationPatch(options) {
    options = options || {};
    const source = String(options.verificationSource || "verified_reconciliation").toLowerCase();
    const allowed = VERIFIED_STATUSES.indexOf(source) >= 0 ? source : "verified_reconciliation";
    const now = new Date().toISOString();
    return {
        verificationStatus: allowed,
        paymentVerifiedAt: now,
        verifiedByAdmin: options.adminEmail || options.adminActor || null,
        paymentVerificationNote: String(options.note || "").trim() || null,
        txHash: normalizeTxHash(options.txHash || "") || undefined
    };
}

module.exports = {
    VERIFIED_STATUSES,
    isDepositPaymentVerified,
    verificationStatusLabel,
    assertCanApproveDeposit,
    buildVerificationPatch,
    normalizeTxHash
};
