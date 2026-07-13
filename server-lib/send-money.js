const {
    normalizeRegistryEmail,
    loadAllAccounts,
    loadAdminRegistry,
    saveAdminRegistry,
    upsertAccount
} = require("./registry");
const { sendTransferEmailsSafely } = require("./send-money-emails");

const SUPPORTED_CURRENCIES = ["USD", "BTC", "ETH", "USDT"];
const HOLDING_KEYS = { BTC: "btc", ETH: "eth", USDT: "usdt" };
const MAX_NOTE_LENGTH = 280;
const DUPLICATE_WINDOW_MS = 60000;

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isValidGvWallet(address) {
    return /^GV[A-Z0-9]{12,28}$/i.test(String(address || "").trim());
}

function generateGvWalletAddress(email) {
    const normalized = normalizeRegistryEmail(email);
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
        hash |= 0;
    }
    const partA = Math.abs(hash).toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(8, "0").slice(0, 8);
    let sum = 0;
    for (let j = 0; j < normalized.length; j++) {
        sum += normalized.charCodeAt(j);
    }
    const partB = sum.toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "Y").padEnd(6, "0").slice(0, 6);
    return "GV" + partA + partB;
}

function ensureGvWallet(account, email) {
    if (!account.gvWalletAddress) {
        account.gvWalletAddress = generateGvWalletAddress(email);
    }
    return account.gvWalletAddress;
}

function maskEmail(email) {
    const parts = String(email || "").split("@");
    if (parts.length !== 2) return "—";
    const local = parts[0];
    const masked = local.length <= 2
        ? local.charAt(0) + "***"
        : local.charAt(0) + "***" + local.charAt(local.length - 1);
    return masked + "@" + parts[1];
}

function maskWallet(address) {
    const value = String(address || "");
    if (value.length <= 10) return value;
    return value.slice(0, 6) + "••••" + value.slice(-4);
}

function getDisplayName(account, email) {
    if (account && account.profile && account.profile.fullName) {
        return account.profile.fullName;
    }
    return email;
}

function isAccountSuspended(account) {
    return !!(account && (account.suspended || account.withdrawalsFrozen));
}

function getBalanceForCurrency(account, currency) {
    currency = String(currency || "USD").toUpperCase();
    if (currency === "USD") {
        return Number(account.cash || 0);
    }
    const key = HOLDING_KEYS[currency];
    if (!key) return 0;
    return Number((account.holdings && account.holdings[key]) || 0);
}

function calculateTransferFee(amount, currency) {
    currency = String(currency || "USD").toUpperCase();
    amount = Number(amount);
    if (!amount || amount <= 0) return 0;
    if (currency === "USD") return 0;
    return Math.max(amount * 0.001, 0.00000001);
}

function generateTransferReference() {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return "GV-TXN-" + stamp + "-" + rand;
}

function formatAmount(amount, currency) {
    currency = String(currency || "USD").toUpperCase();
    amount = Number(amount);
    if (currency === "USD") return "$" + amount.toFixed(2);
    if (currency === "BTC") return amount.toFixed(8) + " BTC";
    if (currency === "ETH") return amount.toFixed(6) + " ETH";
    if (currency === "USDT") return amount.toFixed(2) + " USDT";
    return String(amount);
}

function detectRecipientMethod(query) {
    const value = String(query || "").trim();
    if (!value) return null;
    if (isValidGvWallet(value)) return "wallet";
    if (isValidEmail(value)) return "email";
    return null;
}

function findAccountByWallet(accounts, walletAddress) {
    const target = String(walletAddress || "").trim().toUpperCase();
    if (!target) return null;

    const keys = Object.keys(accounts);
    for (let i = 0; i < keys.length; i++) {
        const email = keys[i];
        const account = accounts[email];
        if (!account || typeof account !== "object") continue;
        const wallet = ensureGvWallet(account, email);
        if (String(wallet).toUpperCase() === target) {
            return { email: email, account: account };
        }
    }
    return null;
}

function buildRecipientPreview(email, account) {
    const verified = account.profile &&
        account.profile.verificationStatus === "Verified" &&
        !!account.profile.ssnLast4;
    const initials = getDisplayName(account, email)
        .split(" ")
        .map(function(part) { return part.charAt(0); })
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return {
        found: true,
        email: email,
        fullName: getDisplayName(account, email),
        initials: initials || "GV",
        verified: verified,
        country: (account.profile && account.profile.country) || "—",
        maskedEmail: maskEmail(email),
        walletAddress: ensureGvWallet(account, email),
        maskedWallet: maskWallet(ensureGvWallet(account, email)),
        walletType: "GlobalVest Internal Wallet"
    };
}

async function lookupRecipient(query) {
    const method = detectRecipientMethod(query);
    if (!method) {
        return { ok: false, error: "Enter a valid GlobalVest email or wallet address." };
    }

    const accounts = await loadAllAccounts();

    if (method === "email") {
        const key = normalizeRegistryEmail(query);
        const account = accounts[key];
        if (!account) {
            return { ok: false, found: false, error: "Recipient not found." };
        }
        return {
            ok: true,
            method: "email",
            recipient: buildRecipientPreview(key, account)
        };
    }

    const match = findAccountByWallet(accounts, query);
    if (!match) {
        return { ok: false, found: false, error: "Recipient not found." };
    }

    return {
        ok: true,
        method: "wallet",
        recipient: buildRecipientPreview(match.email, match.account)
    };
}

function ensureTransferArrays(account) {
    if (!Array.isArray(account.sendMoneyHistory)) account.sendMoneyHistory = [];
    if (!Array.isArray(account.internalTransfers)) account.internalTransfers = [];
}

function pushNotification(account, message, type) {
    account.notifications = Array.isArray(account.notifications) ? account.notifications : [];
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: message,
        time: new Date().toISOString(),
        read: false,
        type: type || "transfer"
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }
}

function applyBalanceDelta(account, currency, delta) {
    currency = String(currency || "USD").toUpperCase();
    delta = Number(delta);
    if (currency === "USD") {
        account.cash = Number(account.cash || 0) + delta;
        return;
    }
    const key = HOLDING_KEYS[currency];
    if (!key) throw new Error("Invalid currency.");
    if (!account.holdings) account.holdings = {};
    account.holdings[key] = Number(account.holdings[key] || 0) + delta;
}

function buildTransferRecord(options) {
    const now = new Date().toISOString();
    return {
        id: "smt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9),
        reference: options.reference || generateTransferReference(),
        senderEmail: options.senderEmail,
        recipientEmail: options.recipientEmail,
        senderWallet: options.senderWallet,
        recipientWallet: options.recipientWallet,
        method: options.method,
        currency: options.currency,
        amount: Number(options.amount),
        fee: Number(options.fee || 0),
        totalDebit: Number(options.totalDebit),
        status: options.status || "completed",
        note: options.note || "",
        ipAddress: options.ipAddress || "",
        deviceInfo: options.deviceInfo || "",
        createdAt: now,
        completedAt: options.status === "completed" ? now : null,
        reversedAt: null,
        reversedBy: null,
        reverseReason: null
    };
}

function isDuplicateTransfer(admin, idempotencyKey) {
    if (!idempotencyKey) return false;
    const keys = admin.processedSendMoneyKeys || {};
    const prev = keys[idempotencyKey];
    if (!prev) return false;
    return (Date.now() - Number(prev)) < DUPLICATE_WINDOW_MS;
}

function markIdempotencyKey(admin, idempotencyKey) {
    if (!idempotencyKey) return;
    if (!admin.processedSendMoneyKeys) admin.processedSendMoneyKeys = {};
    admin.processedSendMoneyKeys[idempotencyKey] = Date.now();
    const entries = Object.entries(admin.processedSendMoneyKeys);
    if (entries.length > 200) {
        entries.sort(function(a, b) { return Number(b[1]) - Number(a[1]); });
        admin.processedSendMoneyKeys = Object.fromEntries(entries.slice(0, 200));
    }
}

async function executeInternalTransfer(payload) {
    payload = payload || {};
    const senderEmail = normalizeRegistryEmail(payload.senderEmail);
    const recipientQuery = String(payload.recipient || payload.recipientEmail || "").trim();
    const currency = String(payload.currency || "USD").toUpperCase();
    const amount = Number(payload.amount);
    const note = String(payload.note || "").trim().slice(0, MAX_NOTE_LENGTH);
    const ipAddress = String(payload.ipAddress || "").slice(0, 64);
    const deviceInfo = String(payload.deviceInfo || "").slice(0, 200);
    const idempotencyKey = String(payload.idempotencyKey || "").trim();

    if (!senderEmail || !isValidEmail(senderEmail)) {
        return { ok: false, error: "You must be logged in with a valid account." };
    }
    if (!recipientQuery) {
        return { ok: false, error: "Enter a recipient email or wallet address." };
    }
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
        return { ok: false, error: "Invalid currency." };
    }
    if (!amount || amount <= 0 || isNaN(amount)) {
        return { ok: false, error: "Enter a valid amount greater than zero." };
    }

    const lookup = await lookupRecipient(recipientQuery);
    if (!lookup.ok || !lookup.recipient) {
        return { ok: false, error: lookup.error || "Recipient not found." };
    }

    const recipientEmail = normalizeRegistryEmail(lookup.recipient.email);
    if (recipientEmail === senderEmail) {
        return { ok: false, error: "You cannot send money to yourself." };
    }

    const accounts = await loadAllAccounts();
    const sender = accounts[senderEmail];
    const recipient = accounts[recipientEmail];

    if (!sender || !recipient) {
        return { ok: false, error: "Sender or recipient account not found." };
    }
    if (isAccountSuspended(sender)) {
        return { ok: false, error: "Your account is restricted. Contact support." };
    }
    if (isAccountSuspended(recipient)) {
        return { ok: false, error: "Recipient account cannot receive transfers." };
    }

    const admin = await loadAdminRegistry();
    if (isDuplicateTransfer(admin, idempotencyKey)) {
        return { ok: false, error: "Duplicate transfer detected. Please wait before retrying." };
    }

    const fee = calculateTransferFee(amount, currency);
    const totalDebit = amount + fee;
    const senderBalance = getBalanceForCurrency(sender, currency);

    if (senderBalance < totalDebit) {
        return {
            ok: false,
            error: "Insufficient " + currency + " balance. Available: " + formatAmount(senderBalance, currency)
        };
    }

    const senderWallet = ensureGvWallet(sender, senderEmail);
    const recipientWallet = ensureGvWallet(recipient, recipientEmail);
    const reference = generateTransferReference();
    const method = lookup.method === "wallet" ? "wallet" : "email";

    const transfer = buildTransferRecord({
        reference: reference,
        senderEmail: senderEmail,
        recipientEmail: recipientEmail,
        senderWallet: senderWallet,
        recipientWallet: recipientWallet,
        method: method,
        currency: currency,
        amount: amount,
        fee: fee,
        totalDebit: totalDebit,
        note: note,
        ipAddress: ipAddress,
        deviceInfo: deviceInfo,
        status: "completed"
    });

    const senderBefore = getBalanceForCurrency(sender, currency);
    const recipientBefore = getBalanceForCurrency(recipient, currency);

    const updatedSender = Object.assign({}, sender);
    const updatedRecipient = Object.assign({}, recipient);

    ensureTransferArrays(updatedSender);
    ensureTransferArrays(updatedRecipient);

    applyBalanceDelta(updatedSender, currency, -totalDebit);
    applyBalanceDelta(updatedRecipient, currency, amount);

    const amountLabel = formatAmount(amount, currency);
    const txDate = new Date().toLocaleString();

    updatedSender.transactions = Array.isArray(sender.transactions) ? sender.transactions.slice() : [];
    updatedSender.transactions.unshift({
        date: txDate,
        description: "Send Money to " + maskEmail(recipientEmail) + " (" + reference + ")",
        amount: currency === "USD" ? -totalDebit : 0
    });

    updatedRecipient.transactions = Array.isArray(recipient.transactions) ? recipient.transactions.slice() : [];
    updatedRecipient.transactions.unshift({
        date: txDate,
        description: "Funds received from " + maskEmail(senderEmail) + " (" + reference + ")",
        amount: currency === "USD" ? amount : 0
    });

    pushNotification(updatedSender,
        "Transfer sent: " + amountLabel + " to " + getDisplayName(recipient, recipientEmail) + " — Ref " + reference,
        "transfer"
    );
    pushNotification(updatedRecipient,
        "Funds received: " + amountLabel + " from " + getDisplayName(sender, senderEmail) + " — Ref " + reference,
        "transfer"
    );

    updatedSender.sendMoneyHistory.unshift(Object.assign({}, transfer, { direction: "sent" }));
    updatedRecipient.sendMoneyHistory.unshift(Object.assign({}, transfer, { direction: "received" }));

    if (updatedSender.sendMoneyHistory.length > 100) {
        updatedSender.sendMoneyHistory = updatedSender.sendMoneyHistory.slice(0, 100);
    }
    if (updatedRecipient.sendMoneyHistory.length > 100) {
        updatedRecipient.sendMoneyHistory = updatedRecipient.sendMoneyHistory.slice(0, 100);
    }

    let savedSender;
    try {
        savedSender = await upsertAccount(senderEmail, updatedSender, {
            cashAuthoritative: currency === "USD",
            eventType: "send-money",
            source: "executeInternalTransfer-sender"
        });
    } catch (err) {
        return { ok: false, error: err.message || "Failed to debit sender account." };
    }

    try {
        await upsertAccount(recipientEmail, updatedRecipient, {
            cashAuthoritative: currency === "USD",
            eventType: "send-money",
            source: "executeInternalTransfer-recipient"
        });
    } catch (err) {
        try {
            const rollbackSender = Object.assign({}, sender);
            await upsertAccount(senderEmail, rollbackSender, {
                cashAuthoritative: currency === "USD",
                eventType: "send-money-rollback",
                source: "executeInternalTransfer-rollback"
            });
        } catch (rollbackErr) {
            console.error("[send-money] rollback failed", rollbackErr.message || rollbackErr);
        }
        return { ok: false, error: "Transfer failed during credit. Sender balance was restored." };
    }

    if (!admin.internalTransfers) admin.internalTransfers = [];
    if (!admin.sendMoneyAuditLog) admin.sendMoneyAuditLog = [];

    admin.internalTransfers.unshift(transfer);
    if (admin.internalTransfers.length > 500) {
        admin.internalTransfers = admin.internalTransfers.slice(0, 500);
    }

    admin.sendMoneyAuditLog.unshift({
        id: "audit-" + Date.now(),
        transferId: transfer.id,
        reference: transfer.reference,
        action: "transfer-completed",
        senderEmail: senderEmail,
        recipientEmail: recipientEmail,
        currency: currency,
        amount: amount,
        senderBalanceBefore: senderBefore,
        senderBalanceAfter: getBalanceForCurrency(savedSender.account || updatedSender, currency),
        recipientBalanceBefore: recipientBefore,
        recipientBalanceAfter: getBalanceForCurrency(updatedRecipient, currency),
        ipAddress: ipAddress,
        deviceInfo: deviceInfo,
        timestamp: new Date().toISOString()
    });
    if (admin.sendMoneyAuditLog.length > 1000) {
        admin.sendMoneyAuditLog = admin.sendMoneyAuditLog.slice(0, 1000);
    }

    markIdempotencyKey(admin, idempotencyKey);
    await saveAdminRegistry(admin);

    const emailResult = await sendTransferEmailsSafely({
        transfer: transfer,
        senderAccount: updatedSender,
        recipientAccount: updatedRecipient
    });

    return {
        ok: true,
        transfer: transfer,
        senderAccount: savedSender.account || updatedSender,
        recipientAccount: updatedRecipient,
        emailSent: !!emailResult.sent,
        emailPartial: !!(emailResult.sender && emailResult.sender.sent) !== !!(emailResult.recipient && emailResult.recipient.sent),
        emailError: emailResult.error || null,
        emailDetails: {
            sender: emailResult.sender || null,
            recipient: emailResult.recipient || null
        }
    };
}

async function reverseInternalTransfer(transferId, adminId, reason) {
    const admin = await loadAdminRegistry();
    const transfers = admin.internalTransfers || [];
    const transfer = transfers.find(function(entry) {
        return String(entry.id) === String(transferId);
    });

    if (!transfer) {
        return { ok: false, error: "Transfer not found." };
    }
    if (transfer.status === "reversed") {
        return { ok: false, error: "Transfer was already reversed." };
    }
    if (transfer.status !== "completed") {
        return { ok: false, error: "Only completed transfers can be reversed." };
    }

    const accounts = await loadAllAccounts();
    const sender = accounts[normalizeRegistryEmail(transfer.senderEmail)];
    const recipient = accounts[normalizeRegistryEmail(transfer.recipientEmail)];

    if (!sender || !recipient) {
        return { ok: false, error: "Sender or recipient account not found." };
    }

    const currency = transfer.currency;
    const amount = Number(transfer.amount);
    const fee = Number(transfer.fee || 0);
    const totalDebit = Number(transfer.totalDebit || (amount + fee));

    const recipientBalance = getBalanceForCurrency(recipient, currency);
    if (recipientBalance < amount) {
        return { ok: false, error: "Recipient no longer has sufficient balance to reverse." };
    }

    const updatedSender = Object.assign({}, sender);
    const updatedRecipient = Object.assign({}, recipient);

    applyBalanceDelta(updatedRecipient, currency, -amount);
    applyBalanceDelta(updatedSender, currency, totalDebit);

    pushNotification(updatedSender,
        "Transfer reversed: " + formatAmount(amount, currency) + " returned — Ref " + transfer.reference,
        "transfer"
    );
    pushNotification(updatedRecipient,
        "Transfer reversed: " + formatAmount(amount, currency) + " debited — Ref " + transfer.reference,
        "transfer"
    );

    transfer.status = "reversed";
    transfer.reversedAt = new Date().toISOString();
    transfer.reversedBy = adminId || "admin";
    transfer.reverseReason = String(reason || "Reversed by admin").trim();

    admin.sendMoneyAuditLog.unshift({
        id: "audit-" + Date.now(),
        transferId: transfer.id,
        reference: transfer.reference,
        action: "transfer-reversed",
        adminId: adminId || "admin",
        reason: transfer.reverseReason,
        currency: currency,
        amount: amount,
        timestamp: transfer.reversedAt
    });

    await upsertAccount(transfer.senderEmail, updatedSender, {
        cashAuthoritative: currency === "USD",
        eventType: "send-money-reverse",
        source: "reverseInternalTransfer-sender"
    });
    await upsertAccount(transfer.recipientEmail, updatedRecipient, {
        cashAuthoritative: currency === "USD",
        eventType: "send-money-reverse",
        source: "reverseInternalTransfer-recipient"
    });
    await saveAdminRegistry(admin);

    return { ok: true, transfer: transfer };
}

async function getTransferHistoryForUser(email, filters) {
    filters = filters || {};
    const key = normalizeRegistryEmail(email);
    const accounts = await loadAllAccounts();
    const account = accounts[key];
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    let history = Array.isArray(account.sendMoneyHistory) ? account.sendMoneyHistory.slice() : [];
    const status = filters.status;
    const period = filters.period;

    if (status && status !== "all") {
        history = history.filter(function(item) { return item.status === status; });
    }

    if (period && period !== "all") {
        const now = Date.now();
        const ranges = {
            today: 86400000,
            week: 604800000,
            month: 2592000000,
            year: 31536000000
        };
        const ms = ranges[period];
        if (ms) {
            history = history.filter(function(item) {
                return now - new Date(item.createdAt).getTime() <= ms;
            });
        }
    }

    return { ok: true, history: history, walletAddress: ensureGvWallet(account, key) };
}

module.exports = {
    SUPPORTED_CURRENCIES,
    generateGvWalletAddress,
    ensureGvWallet,
    lookupRecipient,
    calculateTransferFee,
    getBalanceForCurrency,
    executeInternalTransfer,
    reverseInternalTransfer,
    getTransferHistoryForUser,
    maskEmail,
    maskWallet,
    formatAmount
};
