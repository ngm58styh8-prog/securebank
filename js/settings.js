const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
ensureLinkedBanks(account);
ensureApiKeys(account);
const settings = account.settings;

function saveState() {
    saveAccount(username, account);
}

function loadForm() {
    document.getElementById("themeSelect").value = settings.theme;
    document.getElementById("currencySelect").value = settings.currency;
    document.getElementById("languageSelect").value = settings.language;
    document.getElementById("twoFactorToggle").checked = settings.twoFactorEnabled;
    updateTwoFactorHint();
}

function updateTwoFactorHint() {
    const enabled = document.getElementById("twoFactorToggle").checked;
    document.getElementById("twoFactorHint").textContent = enabled
        ? "Two-factor authentication is enabled."
        : "Add an extra layer of security to your account.";
}

function renderLinkedBanks() {
    const list = document.getElementById("linkedBanksList");
    const banks = account.linkedBanks || [];
    if (!banks.length) {
        list.innerHTML = "<p class=\"setting-hint\">No linked bank accounts yet.</p>";
        return;
    }
    list.innerHTML = banks.map(function(b) {
        return "<div class=\"linked-item\">" + b.name + " · ****" + b.last4 + "</div>";
    }).join("");
}

function renderApiKeys() {
    const list = document.getElementById("apiKeysList");
    const keys = account.apiKeys || [];
    if (!keys.length) {
        list.innerHTML = "<p class=\"setting-hint\">No API keys generated.</p>";
        return;
    }
    list.innerHTML = keys.map(function(k) {
        return "<div class=\"linked-item\"><code>" + k.key + "</code><br><span class=\"ticket-meta\">Created " + k.date + "</span></div>";
    }).join("");
}

function saveSettings() {
    settings.theme = document.getElementById("themeSelect").value;
    settings.currency = document.getElementById("currencySelect").value;
    settings.language = document.getElementById("languageSelect").value;
    settings.twoFactorEnabled = document.getElementById("twoFactorToggle").checked;
    account.settings = settings;
    account.theme = settings.theme;
    saveState();
    applyThemeToDocument(settings.theme);
    alert("Settings saved successfully.");
}

initPageNav("settings");
loadForm();
renderLinkedBanks();
renderApiKeys();

document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("twoFactorToggle").addEventListener("change", updateTwoFactorHint);
document.getElementById("changePasswordBtn").addEventListener("click", function() {
    const form = document.getElementById("changePasswordForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
        document.getElementById("currentPassword").focus();
    }
});

document.getElementById("changePasswordForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmNewPassword").value;
    const msg = document.getElementById("changePasswordMessage");

    if (newPassword !== confirmPassword) {
        msg.textContent = "New password and confirmation do not match.";
        return;
    }

    const result = changeAccountPassword(username, currentPassword, newPassword);
    if (!result.ok) {
        msg.textContent = result.error || "Could not update password.";
        return;
    }

    if (result.account) {
        syncAccountToServer(username, result.account, "password-change");
    }
    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmNewPassword").value = "";
    msg.textContent = "Password updated.";
});
document.getElementById("themeSelect").addEventListener("change", function() {
    applyThemeToDocument(document.getElementById("themeSelect").value);
});

document.getElementById("linkBankForm").addEventListener("submit", function(e) {
    e.preventDefault();
    ensureLinkedBanks(account).push({
        name: document.getElementById("bankName").value.trim(),
        last4: document.getElementById("bankAccountLast4").value.trim(),
        date: new Date().toLocaleString()
    });
    saveState();
    document.getElementById("linkBankForm").reset();
    renderLinkedBanks();
    alert("Bank account linked.");
});

document.getElementById("generateApiKeyBtn").addEventListener("click", function() {
    const key = "sbk_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    ensureApiKeys(account).unshift({
        key: key,
        date: new Date().toLocaleString()
    });
    saveState();
    renderApiKeys();
    alert("API key generated:\n\n" + key + "\n\nStore it securely — it won't be shown again.");
});
