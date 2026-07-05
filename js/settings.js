const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
const settings = account.settings;

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

function saveSettings() {
    settings.theme = document.getElementById("themeSelect").value;
    settings.currency = document.getElementById("currencySelect").value;
    settings.language = document.getElementById("languageSelect").value;
    settings.twoFactorEnabled = document.getElementById("twoFactorToggle").checked;
    account.settings = settings;
    account.theme = settings.theme;
    saveAccount(username, account);
    applyThemeToDocument(settings.theme);
    alert("Settings saved successfully.");
}

function toggleThemeQuick() {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    account.theme = settings.theme;
    document.getElementById("themeSelect").value = settings.theme;
    applyThemeToDocument(settings.theme);
    saveAccount(username, account);
}

applyThemeToDocument(settings.theme);
loadForm();

document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("themeToggle").addEventListener("click", toggleThemeQuick);
document.getElementById("twoFactorToggle").addEventListener("change", updateTwoFactorHint);
document.getElementById("changePasswordBtn").addEventListener("click", function() {
    alert("Password change would be handled securely on a production server.");
});

document.getElementById("themeSelect").addEventListener("change", function() {
    applyThemeToDocument(document.getElementById("themeSelect").value);
});
