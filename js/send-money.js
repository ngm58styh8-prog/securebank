const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
ensureHoldings(account);
ensureGvWallet(account, username);
const settings = getSettings(account);

let recipientData = null;
let lookupTimer = null;
let pendingPayload = null;

function formatBalance(amount, currency) {
    currency = String(currency || "USD").toUpperCase();
    amount = Number(amount) || 0;
    if (currency === "USD") return formatMoney(amount, settings.currency);
    if (currency === "BTC") return amount.toFixed(8) + " BTC";
    if (currency === "ETH") return amount.toFixed(6) + " ETH";
    if (currency === "USDT") return amount.toFixed(2) + " USDT";
    return String(amount);
}

function updateBalances() {
    const currency = document.getElementById("currencySelect").value;
    const amount = parseFloat(document.getElementById("amountInput").value) || 0;
    const balance = getSendMoneyBalance(account, currency);
    const fee = calculateSendMoneyFee(amount, currency);
    const total = amount > 0 ? amount + fee : 0;

    document.getElementById("availableBalance").textContent = formatBalance(balance, currency);
    document.getElementById("estimatedFee").textContent = fee === 0
        ? "Free"
        : formatBalance(fee, currency);
    document.getElementById("totalDebit").textContent = amount > 0
        ? formatBalance(total, currency)
        : "—";

    validateForm();
    updatePreview();
}

function hideRecipientPreview() {
    document.getElementById("recipientPreview").classList.add("hidden");
    document.getElementById("recipientNotFound").classList.add("hidden");
    recipientData = null;
    validateForm();
    updatePreview();
}

function showRecipientPreview(recipient, method) {
    document.getElementById("recipientNotFound").classList.add("hidden");
    document.getElementById("recipientPreview").classList.remove("hidden");
    document.getElementById("recipientAvatar").textContent = recipient.initials || "GV";
    document.getElementById("recipientName").textContent = recipient.fullName;
    document.getElementById("recipientBadge").classList.toggle("hidden", !recipient.verified);
    document.getElementById("recipientMeta").textContent =
        (recipient.country || "—") + " · " + (recipient.walletType || "GlobalVest Wallet");
    document.getElementById("recipientMasked").textContent = method === "wallet"
        ? recipient.maskedWallet
        : recipient.maskedEmail;
    recipientData = { recipient: recipient, method: method };
    validateForm();
    updatePreview();
}

function showRecipientNotFound() {
    document.getElementById("recipientPreview").classList.add("hidden");
    document.getElementById("recipientNotFound").classList.remove("hidden");
    recipientData = null;
    validateForm();
    updatePreview();
}

function lookupRecipient() {
    const query = document.getElementById("recipientInput").value.trim();
    if (!query) {
        hideRecipientPreview();
        return;
    }

    const lookupBtn = document.getElementById("lookupBtn");
    lookupBtn.disabled = true;
    lookupBtn.textContent = "Searching…";

    lookupSendMoneyRecipientAsync(query).then(function(result) {
        lookupBtn.disabled = false;
        lookupBtn.textContent = "Look up";

        if (!result.ok || !result.recipient) {
            showRecipientNotFound();
            return;
        }
        showRecipientPreview(result.recipient, result.method);
    });
}

function updatePreview() {
    const amount = parseFloat(document.getElementById("amountInput").value) || 0;
    const currency = document.getElementById("currencySelect").value;
    const previewEmpty = document.getElementById("previewEmpty");
    const previewContent = document.getElementById("previewContent");

    if (!recipientData || !amount) {
        previewEmpty.classList.remove("hidden");
        previewContent.classList.add("hidden");
        return;
    }

    previewEmpty.classList.add("hidden");
    previewContent.classList.remove("hidden");

    document.getElementById("previewRecipient").textContent = recipientData.recipient.fullName;
    document.getElementById("previewAmount").textContent = formatBalance(amount, currency);
    document.getElementById("previewMethod").textContent =
        recipientData.method === "wallet" ? "Wallet Address" : "Email Address";
    document.getElementById("previewFee").textContent =
        calculateSendMoneyFee(amount, currency) === 0
            ? "Free"
            : formatBalance(calculateSendMoneyFee(amount, currency), currency);
}

function validateForm() {
    const amount = parseFloat(document.getElementById("amountInput").value);
    const currency = document.getElementById("currencySelect").value;
    const sendBtn = document.getElementById("sendBtn");
    const fee = calculateSendMoneyFee(amount, currency);
    const total = amount + fee;
    const balance = getSendMoneyBalance(account, currency);

    const valid = recipientData &&
        amount > 0 &&
        !isNaN(amount) &&
        total <= balance;

    sendBtn.disabled = !valid;
}

function buildConfirmMessage() {
    const amount = parseFloat(document.getElementById("amountInput").value);
    const currency = document.getElementById("currencySelect").value;
    const note = document.getElementById("noteInput").value.trim();
    const name = recipientData.recipient.fullName;
    let msg = "Send " + formatBalance(amount, currency) + " to " + name + "?";
    if (note) msg += "\n\nNote: " + note;
    return msg;
}

function openConfirmModal() {
    document.getElementById("confirmMessage").textContent = buildConfirmMessage();
    document.getElementById("confirmOverlay").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeConfirmModal() {
    document.getElementById("confirmOverlay").classList.add("hidden");
    document.body.style.overflow = "";
}

function showResult(success, title, message) {
    const icon = document.getElementById("resultIcon");
    icon.className = "sm-result-icon " + (success ? "success" : "failure");
    icon.textContent = success ? "✓" : "✕";
    document.getElementById("resultTitle").textContent = title;
    document.getElementById("resultMessage").textContent = message;
    document.getElementById("resultOverlay").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeResultModal() {
    document.getElementById("resultOverlay").classList.add("hidden");
    document.body.style.overflow = "";
}

function executeSend() {
    const sendBtn = document.getElementById("sendBtn");
    const confirmBtn = document.getElementById("confirmSendBtn");
    sendBtn.disabled = true;
    confirmBtn.disabled = true;

    const savedRecipient = recipientData;

    submitSendMoneyAsync(pendingPayload).then(function(result) {
        sendBtn.disabled = false;
        confirmBtn.disabled = false;
        closeConfirmModal();

        if (!result.ok) {
            showResult(false, "Transfer Failed", result.error || "Could not complete transfer.");
            return;
        }

        if (result.senderAccount) {
            Object.assign(account, result.senderAccount);
        }
        document.getElementById("transferReference").textContent = result.transfer.reference;
        document.getElementById("sendMoneyForm").reset();
        hideRecipientPreview();
        updateBalances();

        const recipientName = savedRecipient
            ? savedRecipient.recipient.fullName
            : result.transfer.recipientEmail;

        showResult(
            true,
            "Transfer Successful",
            "Sent " + formatBalance(result.transfer.amount, result.transfer.currency) +
            " to " + recipientName +
            ".\n\nReference: " + result.transfer.reference
        );

        if (typeof refreshNotificationsForUser === "function") {
            refreshNotificationsForUser(username);
        }
    });
}

function handleSubmit(e) {
    e.preventDefault();
    if (!recipientData) return;

    const amount = parseFloat(document.getElementById("amountInput").value);
    const currency = document.getElementById("currencySelect").value;
    const note = document.getElementById("noteInput").value.trim();
    const recipient = document.getElementById("recipientInput").value.trim();

    pendingPayload = {
        senderEmail: username,
        recipient: recipient,
        currency: currency,
        amount: amount,
        note: note,
        ipAddress: "",
        deviceInfo: typeof getDeviceLabel === "function" ? getDeviceLabel() : "",
        idempotencyKey: "sm-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    };

    openConfirmModal();
}

initPageNav("send-money");

document.getElementById("myWalletAddress").textContent = ensureGvWallet(account, username);
saveAccount(username, account, { skipServerSync: true });

document.getElementById("recipientInput").addEventListener("input", function() {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(lookupRecipient, 500);
});

document.getElementById("lookupBtn").addEventListener("click", lookupRecipient);
document.getElementById("amountInput").addEventListener("input", updateBalances);
document.getElementById("currencySelect").addEventListener("change", updateBalances);
document.getElementById("sendMoneyForm").addEventListener("submit", handleSubmit);

document.getElementById("cancelBtn").addEventListener("click", function() {
    window.location.href = "dashboard.html";
});

document.getElementById("confirmCancelBtn").addEventListener("click", closeConfirmModal);
document.getElementById("confirmSendBtn").addEventListener("click", executeSend);
document.getElementById("resultCloseBtn").addEventListener("click", function() {
    closeResultModal();
    window.location.href = "dashboard.html";
});

document.getElementById("copyWalletBtn").addEventListener("click", function() {
    const wallet = ensureGvWallet(account, username);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(wallet).then(function() {
            alert("Wallet address copied.");
        });
    } else {
        alert(wallet);
    }
});

updateBalances();
