const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£" };
const LOCAL_SERVER_PORT = 8765;

(function enforceCanonicalAppOrigin() {
    if (typeof window === "undefined") return;

    if (window.location.protocol === "file:") {
        const page = window.location.pathname.split("/").pop() || "index.html";
        window.location.replace(
            "http://localhost:" + LOCAL_SERVER_PORT + "/" + page +
            window.location.search +
            window.location.hash
        );
        return;
    }

    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

    const port = window.location.port;
    if (port && port !== String(LOCAL_SERVER_PORT)) return;

    const host = window.location.hostname;
    if (host === "127.0.0.1" || host === "[::1]") {
        const targetPort = port || String(LOCAL_SERVER_PORT);
        window.location.replace(
            window.location.protocol + "//localhost:" + targetPort +
            window.location.pathname +
            window.location.search +
            window.location.hash
        );
    }
})();

function getCanonicalAppOrigin() {
    return "http://localhost:" + LOCAL_SERVER_PORT;
}

function isCanonicalAppOrigin() {
    if (typeof window === "undefined") return true;
    if (window.location.protocol === "file:") return false;
    const host = window.location.hostname;
    const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    return (host === "localhost" || host === "127.0.0.1") &&
        String(port) === String(LOCAL_SERVER_PORT);
}

function isLocalServerHost() {
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1";
}

function getLocalServerUrl(path) {
    const file = path.charAt(0) === "/" ? path.slice(1) : path;

    if (window.location.protocol === "file:") {
        return file;
    }

    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        const dir = window.location.pathname.replace(/[^/]*$/, "");
        return window.location.origin + dir + file;
    }

    return file;
}

function showAdminServerHint() {
    const page = window.location.pathname.split("/").pop() || "";
    if (page !== "admin.html" && page !== "admin-dashboard.html") return;
    if (window.location.protocol !== "file:") return;

    document.addEventListener("DOMContentLoaded", function() {
        const box = document.querySelector(".login-box") || document.querySelector(".container");
        if (!box || document.getElementById("adminServerHint")) return;

        const hint = document.createElement("p");
        hint.id = "adminServerHint";
        hint.className = "admin-auth-message error";
        hint.style.display = "block";
        hint.style.marginBottom = "12px";
        hint.textContent = "Open via the local server: run ./start.sh then visit http://localhost:8765/admin.html";
        box.insertBefore(hint, box.firstChild);
    });
}

showAdminServerHint();

if (typeof repairAccountsStorage === "function") {
    repairAccountsStorage();
}

if (typeof pullAccountsFromServer === "function") {
    pullAccountsFromServer()
        .then(function() {
            if (typeof pullAdminFromServer === "function") {
                return pullAdminFromServer();
            }
        })
        .then(function() {
            if (typeof repairAccountsStorage === "function") {
                repairAccountsStorage();
            }
            if (typeof importLocalAccountsToServer === "function") {
                return importLocalAccountsToServer();
            }
        })
        .then(function() {
            if (typeof importLocalAdminToServer === "function") {
                return importLocalAdminToServer();
            }
        })
        .then(function() {
            try {
                window.dispatchEvent(new CustomEvent("globalvest-registry-synced"));
            } catch (e) { /* ignore */ }
        });
}

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

function getDeviceFingerprint() {
    const key = "securebank_device_id";
    let id = localStorage.getItem(key);
    if (!id) {
        id = "dev_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem(key, id);
    }
    return getDeviceLabel() + ":" + id;
}

function formatAuthDateTime(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    } catch (e) {
        return "—";
    }
}

function sendRealEmail(to, subject, body) {
    return fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to, subject: subject, body: body })
    })
        .then(function(response) {
            return response.json().catch(function() {
                return { ok: false, error: "Invalid server response." };
            }).then(function(data) {
                if (!response.ok && data && data.error) return data;
                if (!response.ok) return { ok: false, error: "Email service unavailable." };
                return data;
            });
        })
        .catch(function() {
            return { ok: false, error: "Could not reach email service. Start the app with ./start.sh" };
        });
}

function applyWebsiteSettings() {
    if (typeof getWebsiteSettings !== "function") return;
    const ws = getWebsiteSettings();

    const siteNameEl = document.getElementById("siteName");
    if (siteNameEl) {
        const img = siteNameEl.querySelector("img");
        if (img) img.alt = ws.siteName;
        else siteNameEl.textContent = ws.siteName;
    }

    const siteTaglineEl = document.getElementById("siteTagline");
    if (siteTaglineEl) siteTaglineEl.textContent = ws.siteTagline;

    const dashTitle = document.getElementById("dashboardSiteName");
    if (dashTitle) {
        const textEl = dashTitle.querySelector(".dashboard-brand-text");
        if (textEl) textEl.textContent = ws.siteName + " Dashboard";
        else dashTitle.textContent = ws.siteName + " Dashboard";
        const img = dashTitle.querySelector("img");
        if (img) img.alt = ws.siteName;
    }

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

    if (ws.siteName && document.title.indexOf("GlobalVest") !== -1) {
        document.title = document.title.replace(/GlobalVest/g, ws.siteName);
    }
}

document.addEventListener("DOMContentLoaded", applyWebsiteSettings);
