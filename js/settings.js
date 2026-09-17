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

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDeviceSeen(iso) {
    if (!iso) return "Last seen unavailable";
    if (typeof formatAuthDateTime === "function") return "Last seen " + formatAuthDateTime(iso);
    try {
        return "Last seen " + new Date(iso).toLocaleString();
    } catch (e) {
        return "Last seen unavailable";
    }
}

function getCurrentDevices() {
    if (typeof normalizeKnownDevices === "function") {
        return normalizeKnownDevices(account.knownDevices || []);
    }
    return (account.knownDevices || []).map(function(entry) {
        if (typeof entry === "string") {
            return { fingerprint: entry, label: entry.split(":")[0] || "Device", lastSeen: null };
        }
        return entry;
    });
}

function renderDevices() {
    const list = document.getElementById("devicesList");
    if (!list) return;

    const devices = getCurrentDevices();
    const currentFingerprint = typeof getDeviceFingerprint === "function" ? getDeviceFingerprint() : "";

    if (!devices.length) {
        list.innerHTML = "<p class=\"setting-hint\">No trusted login devices yet. Devices appear here after you sign in.</p>";
        return;
    }

    list.innerHTML = devices.map(function(device) {
        const isCurrent = device.fingerprint === currentFingerprint;
        return (
            "<div class=\"linked-item device-item" + (isCurrent ? " is-current" : "") + "\">" +
            "<div class=\"device-item-copy\">" +
            "<div class=\"device-item-title\">" +
            "<span class=\"device-item-name\">" + escapeHtml(device.label || "Device") + "</span>" +
            (isCurrent ? "<span class=\"device-current-pill\">This device</span>" : "") +
            "</div>" +
            "<div class=\"ticket-meta\">" + escapeHtml(formatDeviceSeen(device.lastSeen)) + "</div>" +
            "</div>" +
            "<button type=\"button\" class=\"device-remove-btn\" data-device-id=\"" +
            escapeHtml(device.fingerprint) + "\">Remove</button>" +
            "</div>"
        );
    }).join("");
}

function removeDeviceFromSettings(fingerprint) {
    const currentFingerprint = typeof getDeviceFingerprint === "function" ? getDeviceFingerprint() : "";
    const devices = getCurrentDevices();
    const target = devices.find(function(device) {
        return device.fingerprint === fingerprint;
    });
    const label = target ? target.label : "this device";
    const isCurrent = fingerprint === currentFingerprint;

    const confirmed = window.confirm(
        isCurrent
            ? "Remove this device (" + label + ") and log out now?\n\nYou will need to sign in again on this device."
            : "Remove " + label + " and end its login session?\n\nThat device will be logged out automatically."
    );
    if (!confirmed) return;

    let result;
    if (typeof removeKnownDevice === "function") {
        result = removeKnownDevice(username, fingerprint);
    } else {
        account.knownDevices = (account.knownDevices || []).filter(function(entry) {
            const key = typeof entry === "string" ? entry : (entry && entry.fingerprint);
            return key !== fingerprint;
        });
        if (!account.sessionRevocations) account.sessionRevocations = {};
        account.sessionRevocations[fingerprint] = new Date().toISOString();
        saveState();
        result = { ok: true, account: account, logoutCurrent: isCurrent };
    }

    if (!result || !result.ok) {
        alert((result && result.error) || "Could not remove device.");
        return;
    }

    if (result.account) {
        const fresh = getAccount(username) || result.account;
        Object.keys(account).forEach(function(key) {
            delete account[key];
        });
        Object.keys(fresh).forEach(function(key) {
            account[key] = fresh[key];
        });
        if (typeof syncAccountToServer === "function") {
            syncAccountToServer(username, account, "login");
        }
    }

    if (result.logoutCurrent || isCurrent) {
        if (typeof clearSession === "function") clearSession();
        window.location.href = "login.html?reason=device-removed";
        return;
    }

    renderDevices();
    if (typeof renderNotificationBell === "function") {
        renderNotificationBell(account);
    }
    alert("Device removed. That device will be logged out.");
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
renderDevices();

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

const devicesList = document.getElementById("devicesList");
if (devicesList) {
    devicesList.addEventListener("click", function(e) {
        const btn = e.target.closest(".device-remove-btn");
        if (!btn) return;
        removeDeviceFromSettings(btn.getAttribute("data-device-id"));
    });
}
