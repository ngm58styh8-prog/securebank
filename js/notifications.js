/**
 * Shared in-app notification bell — presentation layer.
 * Keeps existing read/unread, mark-all, sync, and data handlers unchanged.
 */
(function() {
    const POLL_MS = 15000;
    const STATUS_LABELS = {
        pending: "Pending",
        completed: "Completed",
        failed: "Failed",
        info: "Info"
    };

    let activeFilter = "all";

    function getSessionEmail() {
        if (typeof getSession !== "function") return null;
        const session = getSession();
        if (!session) return null;
        return typeof normalizeEmail === "function"
            ? normalizeEmail(session.email || session.username)
            : String(session.email || session.username || "").trim().toLowerCase();
    }

    function getAccountForBell(email) {
        if (!email) return null;
        if (typeof getRegistryAccount === "function") {
            const merged = getRegistryAccount(email);
            if (merged) return merged;
        }
        return typeof getAccount === "function" ? getAccount(email) : null;
    }

    function formatNotifAmount(amount, currency, signed) {
        if (amount == null || isNaN(Number(amount))) return "";
        currency = String(currency || "USD").toUpperCase();
        const value = Number(amount);
        const abs = Math.abs(value);
        let core = "";
        if (currency === "USD") core = "$" + abs.toFixed(2);
        else if (currency === "BTC") core = abs.toFixed(8) + " BTC";
        else if (currency === "ETH") core = abs.toFixed(6) + " ETH";
        else if (currency === "USDT") core = abs.toFixed(2) + " USDT";
        else core = abs.toFixed(2) + " " + currency;
        if (!signed) return core;
        if (value > 0) return "+" + core;
        if (value < 0) return "-" + core;
        return core;
    }

    function amountToneClass(n) {
        if (n.amount == null || isNaN(Number(n.amount))) return "notif-amount-neutral";
        const value = Number(n.amount);
        if (value > 0) return "notif-amount-positive";
        if (value < 0) return "notif-amount-negative";
        return "notif-amount-neutral";
    }

    function isAdminNotification(n) {
        return !!(n && (n.fromAdmin || n.source === "admin" || n.type === "admin" || n.category === "admin"));
    }

    function isInvestmentNotification(n) {
        if (!n || isAdminNotification(n)) return false;
        const type = String(n.type || n.category || "").toLowerCase();
        const msg = String(n.message || n.title || "").toLowerCase();
        if (type === "trade" || type === "exchange" || type === "market") return true;
        if (msg.indexOf("gold") !== -1 || msg.indexOf("invest") !== -1) return true;
        if (msg.indexOf("buy ") !== -1 || msg.indexOf("sell ") !== -1) return true;
        return false;
    }

    function isTransactionNotification(n) {
        if (!n || isAdminNotification(n) || isInvestmentNotification(n)) return false;
        if (n.source === "transaction") return true;
        const type = n.type || n.category || "";
        return type === "deposit" || type === "withdrawal" || type === "transfer";
    }

    function getCategoryLabel(n) {
        if (isAdminNotification(n)) return "From Admin";
        const type = (n && (n.type || n.category)) || "general";
        if (type === "deposit") return "Deposit";
        if (type === "withdrawal") return "Withdrawal";
        if (type === "transfer") return "Transfer";
        if (type === "trade") return "Investment";
        if (type === "exchange") return "Exchange";
        if (type === "support") return "Support";
        if (type === "market") return "Market";
        if (type === "security") return "Security";
        return "Activity";
    }

    function svgIcon(paths, viewBox) {
        viewBox = viewBox || "0 0 24 24";
        return '<svg class="notif-svg" viewBox="' + viewBox + '" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            paths + "</svg>";
    }

    function getCategoryIcon(n) {
        const type = (n && (n.type || n.category)) || "general";
        const msg = String(n && n.message || "").toLowerCase();

        if (isAdminNotification(n)) {
            return svgIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>');
        }
        if (msg.indexOf("gold") !== -1) {
            return svgIcon('<rect x="3" y="10" width="6" height="10" rx="1"/><rect x="9" y="6" width="6" height="14" rx="1"/><rect x="15" y="8" width="6" height="12" rx="1"/>');
        }
        if (type === "deposit" || msg.indexOf("deposit") !== -1) {
            return svgIcon('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12v4"/><path d="m15 15 3 3 3-3"/>');
        }
        if (type === "withdrawal" || msg.indexOf("withdraw") !== -1) {
            return svgIcon('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 16v-4"/><path d="m15 13 3-3 3 3"/>');
        }
        if (type === "transfer" || msg.indexOf("transfer") !== -1 || msg.indexOf("funds received") !== -1) {
            return svgIcon('<path d="m17 3 4 4-4 4"/><path d="M3 7h18"/><path d="m7 21-4-4 4-4"/><path d="M21 17H3"/>');
        }
        if (type === "trade" || type === "exchange" || msg.indexOf("buy") !== -1 || msg.indexOf("sell") !== -1) {
            return svgIcon('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>');
        }
        if (type === "market") {
            return svgIcon('<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>');
        }
        if (type === "security" || msg.indexOf("password") !== -1 || msg.indexOf("login") !== -1 || msg.indexOf("device") !== -1) {
            return svgIcon('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');
        }
        if (type === "support") {
            return svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>');
        }
        return svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function bellButtonMarkup() {
        return '<button type="button" class="gv-icon-btn icon-btn notif-bell-btn" id="notifBtn" title="Notifications" aria-label="Notifications" aria-expanded="false">' +
            svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>') +
            '<span id="notifCount" class="badge notif-badge" style="display:none">0</span>' +
            "</button>";
    }

    function panelMarkup() {
        return '<div class="notif-center">' +
            '<div class="notif-header">' +
            '<div class="notif-header-copy">' +
            '<div class="notif-header-title">' +
            '<span class="notif-header-icon" aria-hidden="true">' +
            svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>') +
            "</span>" +
            "<span>Notifications</span>" +
            "</div>" +
            '<p class="notif-header-sub">Stay updated with your account activity</p>' +
            "</div>" +
            '<button type="button" class="notif-mark-all" id="notifMarkAllBtn">Mark all as read</button>' +
            "</div>" +
            '<div class="notif-filters" role="tablist" aria-label="Notification filters">' +
            filterButtonHtml("all", "All", true) +
            filterButtonHtml("transactions", "Transactions", false) +
            filterButtonHtml("investments", "Investments", false) +
            filterButtonHtml("admin", "Admin", false) +
            "</div>" +
            '<div id="notifList" class="notif-list"></div>' +
            "</div>";
    }

    function filterButtonHtml(key, label, active) {
        return '<button type="button" class="notif-filter-btn' + (active ? " active" : "") +
            '" data-notif-filter="' + key + '" role="tab" aria-selected="' + (active ? "true" : "false") + '">' +
            '<span class="notif-filter-label">' + label + "</span>" +
            '<span class="notif-filter-count" data-filter-count="' + key + '">0</span>' +
            "</button>";
    }

    function ensureBellMarkup() {
        const host = document.querySelector(".gv-header-actions") ||
            document.querySelector("header .header-right");
        let btn = document.getElementById("notifBtn");
        let panel = document.getElementById("notifPanel");
        let wrap = btn ? btn.closest(".notif-bell-wrap") : document.querySelector(".notif-bell-wrap");

        if (!btn) {
            if (!host) return;
            wrap = document.createElement("div");
            wrap.className = "notif-bell-wrap";
            wrap.innerHTML = bellButtonMarkup() +
                '<div id="notifPanel" class="notif-panel hidden" role="dialog" aria-label="Notifications">' +
                panelMarkup() +
                "</div>";

            const themeBtn = document.getElementById("themeToggle");
            if (themeBtn && host.contains(themeBtn)) {
                host.insertBefore(wrap, themeBtn);
            } else {
                host.insertBefore(wrap, host.firstChild);
            }
            btn = document.getElementById("notifBtn");
            panel = document.getElementById("notifPanel");
            ensureMarkAllButton();
            ensureFilterButtons();
            return;
        }

        if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "notif-bell-wrap";
            btn.parentNode.insertBefore(wrap, btn);
            wrap.appendChild(btn);
        }

        if (!btn.classList.contains("notif-bell-btn")) {
            btn.classList.add("notif-bell-btn");
        }
        if (!btn.querySelector(".notif-svg")) {
            const count = document.getElementById("notifCount");
            btn.innerHTML =
                svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>') +
                '<span id="notifCount" class="badge notif-badge" style="display:none">' +
                (count ? count.textContent : "0") +
                "</span>";
            if (count && count.style.display === "none") {
                const next = document.getElementById("notifCount");
                if (next) next.style.display = "none";
            }
        }

        btn.setAttribute("aria-label", "Notifications");
        if (!btn.hasAttribute("aria-expanded")) {
            btn.setAttribute("aria-expanded", "false");
        }
        const count = document.getElementById("notifCount");
        if (count && count.className.indexOf("notif-badge") === -1) {
            count.className = (count.className + " notif-badge").trim();
        }

        if (!panel) {
            panel = document.createElement("div");
            panel.id = "notifPanel";
            panel.className = "notif-panel hidden";
            panel.setAttribute("role", "dialog");
            panel.setAttribute("aria-label", "Notifications");
            panel.innerHTML = panelMarkup();
            wrap.appendChild(panel);
        } else if (!wrap.contains(panel)) {
            wrap.appendChild(panel);
        }

        if (!panel.querySelector(".notif-center")) {
            panel.innerHTML = panelMarkup();
            delete panel.dataset.notifBound;
            const markAll = document.getElementById("notifMarkAllBtn");
            if (markAll) delete markAll.dataset.notifBound;
        }

        if (!document.getElementById("notifList")) {
            const list = document.createElement("div");
            list.id = "notifList";
            list.className = "notif-list";
            const center = panel.querySelector(".notif-center") || panel;
            center.appendChild(list);
        }

        ensureMarkAllButton();
        ensureFilterButtons();
        wireNotificationEvents();
    }

    function ensureMarkAllButton() {
        const header = document.querySelector("#notifPanel .notif-header");
        if (!header) return;
        let btn = document.getElementById("notifMarkAllBtn");
        if (!btn) {
            btn = document.createElement("button");
            btn.type = "button";
            btn.id = "notifMarkAllBtn";
            btn.className = "notif-mark-all";
            header.appendChild(btn);
        }
        btn.textContent = "Mark all as read";
        btn.className = "notif-mark-all";
    }

    function ensureFilterButtons() {
        const root = document.querySelector("#notifPanel .notif-filters");
        if (!root) return;
        if (!root.querySelector('[data-notif-filter="investments"]')) {
            root.innerHTML =
                filterButtonHtml("all", "All", activeFilter === "all") +
                filterButtonHtml("transactions", "Transactions", activeFilter === "transactions") +
                filterButtonHtml("investments", "Investments", activeFilter === "investments") +
                filterButtonHtml("admin", "Admin", activeFilter === "admin");
        }
        Array.prototype.forEach.call(root.querySelectorAll("[data-notif-filter]"), function(btn) {
            const on = btn.getAttribute("data-notif-filter") === activeFilter;
            btn.classList.toggle("active", on);
            btn.setAttribute("aria-selected", on ? "true" : "false");
        });
    }

    function updateFilterCounts(notifications) {
        const counts = {
            all: notifications.filter(function(n) { return !n.read; }).length,
            transactions: notifications.filter(function(n) { return isTransactionNotification(n) && !n.read; }).length,
            investments: notifications.filter(function(n) { return isInvestmentNotification(n) && !n.read; }).length,
            admin: notifications.filter(function(n) { return isAdminNotification(n) && !n.read; }).length
        };
        Object.keys(counts).forEach(function(key) {
            const el = document.querySelector('[data-filter-count="' + key + '"]');
            if (!el) return;
            const value = counts[key];
            el.textContent = value > 99 ? "99+" : String(value);
            el.hidden = value <= 0;
            el.classList.toggle("is-empty", value <= 0);
        });
    }

    function filterNotifications(notifications) {
        if (activeFilter === "admin") return notifications.filter(isAdminNotification);
        if (activeFilter === "transactions") return notifications.filter(isTransactionNotification);
        if (activeFilter === "investments") return notifications.filter(isInvestmentNotification);
        return notifications;
    }

    function emptyMessage() {
        if (activeFilter === "admin") return "No admin notifications yet.";
        if (activeFilter === "transactions") return "No transactions yet.";
        if (activeFilter === "investments") return "No investment updates yet.";
        return "You're all caught up.";
    }

    function startOfDay(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    function groupLabelForTime(iso) {
        const parsed = iso ? new Date(iso) : new Date();
        if (isNaN(parsed.getTime())) {
            return { key: "unknown", label: "Earlier", sub: "" };
        }
        const today = startOfDay(new Date());
        const day = startOfDay(parsed);
        const full = parsed.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric"
        });
        if (day === today) {
            return { key: "today", label: "Today", sub: full };
        }
        if (day === today - 86400000) {
            return { key: "yesterday", label: "Yesterday", sub: full };
        }
        return {
            key: String(day),
            label: parsed.toLocaleDateString(undefined, { weekday: "long" }),
            sub: full
        };
    }

    function groupNotificationsByDate(notifications) {
        const groups = [];
        const map = {};
        notifications.forEach(function(n) {
            const meta = groupLabelForTime(n.time);
            if (!map[meta.key]) {
                map[meta.key] = { key: meta.key, label: meta.label, sub: meta.sub, items: [] };
                groups.push(map[meta.key]);
            }
            map[meta.key].items.push(n);
        });
        return groups;
    }

    function formatTimeOnly(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        return d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    function renderNotificationItem(n, index) {
        const status = n.status || "completed";
        const statusLabel = STATUS_LABELS[status] || status;
        const amountLabel = formatNotifAmount(n.amount, n.currency, true);
        const title = n.title || getCategoryLabel(n);
        const message = n.message || "";
        const time = formatTimeOnly(n.time);
        const adminClass = isAdminNotification(n) ? " notif-item-admin" : "";
        const investClass = isInvestmentNotification(n) ? " notif-item-invest" : "";
        const txClass = isTransactionNotification(n) ? " notif-item-tx" : "";
        const delay = Math.min(index * 35, 280);

        return (
            '<article class="notif-item ' + (n.read ? "read" : "unread") + adminClass + investClass + txClass +
            '" data-notif-id="' + escapeHtml(String(n.id)) + '" style="--notif-delay:' + delay + 'ms">' +
            '<div class="notif-item-main">' +
            '<div class="notif-type-icon" aria-hidden="true">' + getCategoryIcon(n) + "</div>" +
            '<div class="notif-item-body">' +
            '<div class="notif-item-heading">' +
            '<h3 class="notif-item-title">' + escapeHtml(title) + "</h3>" +
            (!n.read ? '<span class="notif-unread-dot" aria-hidden="true"></span>' : "") +
            "</div>" +
            '<p class="notif-item-message">' + escapeHtml(message) + "</p>" +
            '<div class="notif-item-meta">' +
            '<span class="notif-time">' + escapeHtml(time) + "</span>" +
            '<span class="notif-status notif-status-' + escapeHtml(status) + '">' + escapeHtml(statusLabel) + "</span>" +
            "</div>" +
            "</div>" +
            '<div class="notif-item-aside">' +
            (amountLabel
                ? '<div class="notif-item-amount ' + amountToneClass(n) + '">' + escapeHtml(amountLabel) + "</div>"
                : "") +
            (!n.read
                ? '<button type="button" class="notif-read-btn" data-notif-id="' + escapeHtml(String(n.id)) + '" title="Mark as read" aria-label="Mark as read">' +
                  svgIcon('<path d="M20 6 9 17l-5-5"/>') +
                  "</button>"
                : "") +
            "</div>" +
            "</div>" +
            "</article>"
        );
    }

    function renderGroupedList(notifications) {
        const groups = groupNotificationsByDate(notifications);
        let html = "";
        let index = 0;
        groups.forEach(function(group) {
            html += '<section class="notif-group">' +
                '<header class="notif-group-header">' +
                '<span class="notif-group-label">' + escapeHtml(group.label) + "</span>" +
                (group.sub ? '<span class="notif-group-sub">' + escapeHtml(group.sub) + "</span>" : "") +
                "</header>" +
                '<div class="notif-group-list">';
            group.items.forEach(function(item) {
                html += renderNotificationItem(item, index++);
            });
            html += "</div></section>";
        });
        return html;
    }

    function prepareAccountNotifications(email, account) {
        if (!account) return [];
        if (typeof syncAccountNotifications === "function") {
            syncAccountNotifications(email, account);
        } else {
            if (typeof ensureNotifications === "function") {
                ensureNotifications(account);
            }
            if (typeof hydrateNotificationsFromTransactions === "function") {
                hydrateNotificationsFromTransactions(account);
            }
        }
        if (typeof normalizeNotificationList === "function") {
            account.notifications = normalizeNotificationList(account.notifications || []);
        }
        return Array.isArray(account.notifications) ? account.notifications : [];
    }

    function renderNotificationBell(accountOrEmail) {
        const email = typeof accountOrEmail === "string"
            ? accountOrEmail
            : getSessionEmail();
        let account = typeof accountOrEmail === "object" && accountOrEmail
            ? accountOrEmail
            : getAccountForBell(email);

        if (!account) return;

        ensureBellMarkup();
        const notifications = prepareAccountNotifications(email, account);
        const list = document.getElementById("notifList");
        const count = document.getElementById("notifCount");
        const unread = notifications.filter(function(n) { return !n.read; }).length;
        const visible = filterNotifications(notifications);

        if (count) {
            count.textContent = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : "";
            count.style.display = unread > 0 ? "inline-flex" : "none";
        }

        ensureFilterButtons();
        updateFilterCounts(notifications);
        if (!list) return;

        if (!visible.length) {
            list.innerHTML = '<div class="notif-empty">' +
                '<div class="notif-empty-icon" aria-hidden="true">' +
                svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>') +
                "</div>" +
                "<p>" + emptyMessage() + "</p>" +
                "</div>";
            return;
        }

        list.innerHTML = renderGroupedList(visible);
    }

    function persistAndRender(email, account) {
        if (typeof saveAccount === "function") {
            saveAccount(email, account, { eventType: "login" });
        } else if (typeof localStorage !== "undefined") {
            const accounts = typeof getAllAccounts === "function" ? getAllAccounts() : {};
            accounts[email] = account;
            localStorage.setItem("securebank_accounts", JSON.stringify(accounts));
        }
        renderNotificationBell(account);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("globalvest-notifications-updated", {
                detail: { email: email }
            }));
        }
    }

    function markNotificationReadForUser(email, notificationId) {
        if (typeof markNotificationRead === "function") {
            const result = markNotificationRead(email, notificationId);
            if (result && result.account) {
                renderNotificationBell(result.account);
            }
            return result;
        }

        const account = getAccountForBell(email);
        if (!account || !Array.isArray(account.notifications)) return null;
        const target = account.notifications.find(function(n) {
            return String(n.id) === String(notificationId);
        });
        if (!target || target.read) return { account: account, changed: false };
        target.read = true;
        persistAndRender(email, account);
        return { account: account, changed: true };
    }

    function markAllNotificationsReadForUser(email) {
        if (typeof markAllNotificationsRead === "function") {
            const result = markAllNotificationsRead(email);
            if (result && result.account) {
                renderNotificationBell(result.account);
            }
            return result;
        }

        const account = getAccountForBell(email);
        if (!account || !Array.isArray(account.notifications)) return null;
        let changed = false;
        account.notifications.forEach(function(n) {
            if (!n.read) {
                n.read = true;
                changed = true;
            }
        });
        if (changed) persistAndRender(email, account);
        return { account: account, changed: changed };
    }

    function refreshNotificationsForUser(email, options) {
        options = options || {};
        email = email || getSessionEmail();
        if (!email) return Promise.resolve(null);

        const applyAccount = function(acct) {
            if (acct) renderNotificationBell(acct);
            return acct;
        };

        if (options.skipPull || typeof pullAccountsFromServer !== "function") {
            return Promise.resolve(applyAccount(getAccountForBell(email)));
        }

        return pullAccountsFromServer().then(function() {
            return applyAccount(getAccountForBell(email));
        }).catch(function() {
            return applyAccount(getAccountForBell(email));
        });
    }

    function setFilter(filter) {
        if (filter === "admin" || filter === "transactions" || filter === "investments") {
            activeFilter = filter;
        } else {
            activeFilter = "all";
        }
        ensureFilterButtons();
        renderNotificationBell(getSessionEmail());
    }

    function openPanel() {
        const panel = document.getElementById("notifPanel");
        const btn = document.getElementById("notifBtn");
        if (!panel) return;
        panel.classList.remove("hidden");
        panel.classList.add("is-open");
        if (btn) btn.setAttribute("aria-expanded", "true");
        refreshNotificationsForUser(getSessionEmail());
    }

    function closePanel() {
        const panel = document.getElementById("notifPanel");
        const btn = document.getElementById("notifBtn");
        if (!panel) return;
        panel.classList.add("hidden");
        panel.classList.remove("is-open");
        if (btn) btn.setAttribute("aria-expanded", "false");
    }

    function wireNotificationEvents() {
        const notifBtn = document.getElementById("notifBtn");
        const markAllBtn = document.getElementById("notifMarkAllBtn");
        const notifPanel = document.getElementById("notifPanel");

        if (notifBtn && !notifBtn.dataset.notifBound) {
            notifBtn.dataset.notifBound = "1";
            notifBtn.addEventListener("click", function(e) {
                e.stopPropagation();
                const panel = document.getElementById("notifPanel");
                if (!panel) return;
                if (panel.classList.contains("hidden")) openPanel();
                else closePanel();
            });
        }

        if (markAllBtn && !markAllBtn.dataset.notifBound) {
            markAllBtn.dataset.notifBound = "1";
            markAllBtn.addEventListener("click", function(e) {
                e.stopPropagation();
                markAllNotificationsReadForUser(getSessionEmail());
            });
        }

        if (notifPanel && !notifPanel.dataset.notifBound) {
            notifPanel.dataset.notifBound = "1";
            notifPanel.addEventListener("click", function(e) {
                e.stopPropagation();
                const filterBtn = e.target.closest("[data-notif-filter]");
                if (filterBtn) {
                    setFilter(filterBtn.getAttribute("data-notif-filter"));
                    return;
                }
                const readBtn = e.target.closest(".notif-read-btn");
                const item = e.target.closest(".notif-item.unread");
                const id = readBtn
                    ? readBtn.dataset.notifId
                    : (item ? item.dataset.notifId : null);
                if (id) {
                    markNotificationReadForUser(getSessionEmail(), id);
                }
            });
        }

        if (!document.body.dataset.notifDismissBound) {
            document.body.dataset.notifDismissBound = "1";
            document.addEventListener("click", function(e) {
                const panel = document.getElementById("notifPanel");
                if (!panel || panel.classList.contains("hidden")) return;
                if (!e.target.closest("#notifBtn") && !e.target.closest("#notifPanel")) {
                    closePanel();
                }
            });
        }
    }

    let pollTimer = null;

    function initNotificationBell(options) {
        options = options || {};
        const email = getSessionEmail();
        if (!email) return;

        ensureBellMarkup();
        wireNotificationEvents();
        renderNotificationBell(getAccountForBell(email));

        refreshNotificationsForUser(email).then(function() {
            renderNotificationBell(getAccountForBell(email));
        });

        if (!window.__gvNotifListenersBound) {
            window.__gvNotifListenersBound = true;

            window.addEventListener("globalvest-accounts-changed", function() {
                renderNotificationBell(getAccountForBell(getSessionEmail()));
            });

            window.addEventListener("globalvest-registry-synced", function() {
                refreshNotificationsForUser(getSessionEmail());
            });

            window.addEventListener("globalvest-notifications-updated", function() {
                renderNotificationBell(getAccountForBell(getSessionEmail()));
            });

            window.addEventListener("storage", function(e) {
                if (e.key === "securebank_accounts") {
                    refreshNotificationsForUser(getSessionEmail(), { skipPull: true });
                }
            });

            document.addEventListener("visibilitychange", function() {
                if (!document.hidden) {
                    refreshNotificationsForUser(getSessionEmail());
                }
            });

            window.addEventListener("focus", function() {
                refreshNotificationsForUser(getSessionEmail());
            });
        }

        if (!pollTimer && options.poll !== false) {
            pollTimer = setInterval(function() {
                refreshNotificationsForUser(getSessionEmail());
            }, options.pollMs || POLL_MS);
        }
    }

    window.initNotificationBell = initNotificationBell;
    window.renderNotificationBell = renderNotificationBell;
    window.refreshNotificationsForUser = refreshNotificationsForUser;
    window.markNotificationReadForUser = markNotificationReadForUser;
    window.markAllNotificationsReadForUser = markAllNotificationsReadForUser;
    window.normalizeNotificationList = typeof normalizeNotificationList === "function"
        ? normalizeNotificationList
        : function(list) { return list || []; };

    if (typeof getSession === "function" && getSession()) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function() {
                initNotificationBell();
            });
        } else {
            initNotificationBell();
        }
    }
})();
