const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£" };

function formatMoney(amount, currency) {
    currency = currency || "USD";
    const symbol = CURRENCY_SYMBOLS[currency] || "$";
    return symbol + Number(amount).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatSignedMoney(amount, currency) {
    const sign = amount < 0 ? "-" : "+";
    const symbol = CURRENCY_SYMBOLS[currency || "USD"] || "$";
    return sign + symbol + Math.abs(amount).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function applyThemeToDocument(theme) {
    document.body.dataset.theme = theme === "dark" ? "dark" : "";
    const toggle = document.getElementById("themeToggle");
    if (toggle) toggle.textContent = theme === "dark" ? "☀️" : "🌙";
}

function ensureAnalytics(account) {
    if (!account.analytics) {
        account.analytics = {
            dayStartValue: null,
            dayStartDate: "",
            monthStartValue: null,
            monthStartMonth: ""
        };
    }
    return account.analytics;
}

function seedDefaultNotifications() {
    return [
        { id: 1, message: "BTC purchased successfully", time: new Date().toISOString(), read: false },
        { id: 2, message: "ETH price increased 3.2%", time: new Date(Date.now() - 3600000).toISOString(), read: false },
        { id: 3, message: "Login from MacBook", time: new Date(Date.now() - 7200000).toISOString(), read: false },
        { id: 4, message: "Deposit completed", time: new Date(Date.now() - 86400000).toISOString(), read: true }
    ];
}

function getDeviceLabel() {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) return "MacBook";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Windows/.test(ua)) return "Windows PC";
    if (/Android/.test(ua)) return "Android";
    return "Unknown Device";
}

function applyWebsiteSettings() {
    if (typeof getWebsiteSettings !== "function") return;
    const ws = getWebsiteSettings();

    const siteNameEl = document.getElementById("siteName");
    if (siteNameEl) siteNameEl.textContent = "🏦 " + ws.siteName;

    const siteTaglineEl = document.getElementById("siteTagline");
    if (siteTaglineEl) siteTaglineEl.textContent = ws.siteTagline;

    const dashTitle = document.getElementById("dashboardSiteName");
    if (dashTitle) dashTitle.textContent = "🏦 " + ws.siteName + " Dashboard";

    document.querySelectorAll("[data-site-name]").forEach(function(el) {
        el.textContent = ws.siteName;
    });

    const annEl = document.getElementById("siteAnnouncement");
    if (annEl) {
        const text = ws.maintenanceMode
            ? (ws.announcement || "The site is temporarily under maintenance. Some features may be unavailable.")
            : ws.announcement;
        if (text) {
            annEl.textContent = text;
            annEl.classList.remove("hidden");
            if (ws.maintenanceMode) annEl.classList.add("maintenance");
            else annEl.classList.remove("maintenance");
        } else {
            annEl.textContent = "";
            annEl.classList.add("hidden");
            annEl.classList.remove("maintenance");
        }
    }

    if (ws.siteName && document.title.indexOf("SecureBank") !== -1) {
        document.title = document.title.replace(/SecureBank/g, ws.siteName);
    }
}

document.addEventListener("DOMContentLoaded", function() {
    warnIfFileProtocol();
    applyWebsiteSettings();
});

function warnIfFileProtocol() {
    if (window.location.protocol !== "file:") return;

    const page = window.location.pathname.split("/").pop() || "index.html";
    const url = "http://localhost:8765/" + page;
    const el = document.createElement("div");
    el.className = "server-warning";
    el.innerHTML =
        "This site must run through a local server. " +
        'Open <a href="' + url + '">' + url + "</a> instead of the file directly.";
    document.body.prepend(el);
}
