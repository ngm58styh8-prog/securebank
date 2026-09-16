/**
 * Shared in-app notification bell — all authenticated customer pages.
 * Shows transaction history and admin notifications.
 */
(function() {
    const POLL_MS = 15000;
    const STATUS_LABELS = {
        pending: "Pending",
        completed: "Completed",
        failed: "Failed"
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

    function formatNotifAmount(amount, currency) {
        if (amount == null || isNaN(Number(amount))) return "";
        currency = String(currency || "USD").toUpperCase();
        const value = Number(amount);
        if (currency === "USD") return "$" + value.toFixed(2);
        if (currency === "BTC") return value.toFixed(8) + " BTC";
        if (currency === "ETH") return value.toFixed(6) + " ETH";
        if (currency === "USDT") return value.toFixed(2) + " USDT";
        return value.toFixed(2) + " " + currency;
    }

    function isAdminNotification(n) {
        return !!(n && (n.fromAdmin || n.source === "admin" || n.type === "admin" || n.category === "admin"));
    }

    function isTransactionNotification(n) {
        if (!n || isAdminNotification(n)) return false;
        if (n.source === "transaction") return true;
        const type = n.type || n.category || "";
        return type === "deposit" || type === "withdrawal" || type === "transfer" ||
            type === "trade" || type === "exchange";
    }

    function getCategoryLabel(n) {
        if (isAdminNotification(n)) return "From Admin";
        const type = (n && (n.type || n.category)) || "general";
        if (type === "deposit") return "Deposit";
        if (type === "withdrawal") return "Withdrawal";
        if (type === "transfer") return "Transfer";
        if (type === "trade") return "Trade";
        if (type === "exchange") return "Exchange";
        if (type === "support") return "Support";
        if (type === "market") return "Market";
        return "Activity";
    }

    function getCategoryIcon(n) {
        if (isAdminNotification(n)) return "🛡️";
        const type = (n && (n.type || n.category)) || "general";
        if (type === "deposit") return "↓";
        if (type === "withdrawal") return "↑";
        if (type === "transfer") return "⇄";
        if (type === "trade") return "📈";
        if (type === "exchange") return "💱";
        if (type === "support") return "💬";
        if (type === "market") return "📊";
        return "🔔";
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function panelMarkup() {
        return '<div class="notif-header">' +
            '<span>🔔 Notifications</span>' +
            '<button type="button" class="notif-mark-all" id="notifMarkAllBtn">Mark all read</button>' +
            "</div>" +
            '<div class="notif-filters" role="tablist" aria-label="Notification filters">' +
            '<button type="button" class="notif-filter-btn active" data-notif-filter="all">All</button>' +
            '<button type="button" class="notif-filter-btn" data-notif-filter="transactions">Transactions</button>' +
            '<button type="button" class="notif-filter-btn" data-notif-filter="admin">Admin</button>' +
            "</div>" +
            '<div id="notifList" class="notif-list"></div>';
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
            wrap.innerHTML =
                '<button type="button" class="gv-icon-btn icon-btn" id="notifBtn" title="Notifications" aria-label="Notifications" aria-expanded="false">' +
                '🔔 <span id="notifCount" class="badge notif-badge" style="display:none">0</span>' +
                "</button>" +
                '<div id="notifPanel" class="notif-panel hidden" role="dialog" aria-label="Notifications">' +
                panelMarkup() +
                "</div>";

            const themeBtn = document.getElementById("themeToggle");
            if (themeBtn && host.contains(themeBtn)) {
                host.insertBefore(wrap, themeBtn);
            } else {
                host.insertBefore(wrap, host.firstChild);
            }
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

        if (!panel.querySelector(".notif-filters")) {
            const header = panel.querySelector(".notif-header");
            const filters = document.createElement("div");
            filters.className = "notif-filters";
            filters.setAttribute("role", "tablist");
            filters.setAttribute("aria-label", "Notification filters");
            filters.innerHTML =
                '<button type="button" class="notif-filter-btn active" data-notif-filter="all">All</button>' +
                '<button type="button" class="notif-filter-btn" data-notif-filter="transactions">Transactions</button>' +
                '<button type="button" class="notif-filter-btn" data-notif-filter="admin">Admin</button>';
            if (header && header.nextSibling) {
                panel.insertBefore(filters, header.nextSibling);
            } else {
                panel.appendChild(filters);
            }
        }

        if (!document.getElementById("notifList")) {
            const list = document.createElement("div");
            list.id = "notifList";
            list.className = "notif-list";
            panel.appendChild(list);
        }

        ensureMarkAllButton();
        ensureFilterButtons();
    }

    function ensureMarkAllButton() {
        const header = document.querySelector("#notifPanel .notif-header");
        if (!header || document.getElementById("notifMarkAllBtn")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "notifMarkAllBtn";
        btn.className = "notif-mark-all";
        btn.textContent = "Mark all read";
        header.appendChild(btn);
    }

    function ensureFilterButtons() {
        const root = document.querySelector("#notifPanel .notif-filters");
        if (!root) return;
        Array.prototype.forEach.call(root.querySelectorAll("[data-notif-filter]"), function(btn) {
            btn.classList.toggle("active", btn.getAttribute("data-notif-filter") === activeFilter);
        });
    }

    function filterNotifications(notifications) {
        if (activeFilter === "admin") {
            return notifications.filter(isAdminNotification);
        }
        if (activeFilter === "transactions") {
            return notifications.filter(isTransactionNotification);
        }
        return notifications;
    }

    function emptyMessage() {
        if (activeFilter === "admin") return "No admin notifications yet.";
        if (activeFilter === "transactions") return "No transactions yet.";
        return "No transactions or admin notices yet.";
    }

    function renderNotificationItem(n) {
        const status = n.status || "completed";
        const statusLabel = STATUS_LABELS[status] || status;
        const amountLabel = formatNotifAmount(n.amount, n.currency);
        const title = n.title || getCategoryLabel(n);
        const message = n.message || "";
        const time = n.time ? new Date(n.time).toLocaleString() : "";
        const adminClass = isAdminNotification(n) ? " notif-item-admin" : "";
        const txClass = isTransactionNotification(n) ? " notif-item-tx" : "";

        return (
            '<div class="notif-item ' + (n.read ? "read" : "unread") + adminClass + txClass +
            '" data-notif-id="' + escapeHtml(String(n.id)) + '">' +
            '<div class="notif-item-top">' +
            '<span class="notif-type-icon" aria-hidden="true">' + getCategoryIcon(n) + "</span>" +
            '<div class="notif-item-body">' +
            '<div class="notif-item-title">' + escapeHtml(title) +
            (isAdminNotification(n) ? '<span class="notif-admin-pill">Admin</span>' : "") +
            "</div>" +
            '<div class="notif-item-message">' + escapeHtml(message) + "</div>" +
            (amountLabel
                ? '<div class="notif-item-amount">' + escapeHtml(amountLabel) + "</div>"
                : "") +
            '<div class="notif-item-meta">' +
            '<span class="notif-status notif-status-' + escapeHtml(status) + '">' + escapeHtml(statusLabel) + "</span>" +
            '<span class="notif-time">' + escapeHtml(time) + "</span>" +
            "</div>" +
            "</div>" +
            (!n.read
                ? '<button type="button" class="notif-read-btn" data-notif-id="' + escapeHtml(String(n.id)) + '" title="Mark as read">✓</button>'
                : "") +
            "</div>" +
            "</div>"
        );
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
        if (!list) return;

        if (!visible.length) {
            list.innerHTML = '<div class="notif-empty">' + emptyMessage() + "</div>";
            return;
        }

        list.innerHTML = visible.map(renderNotificationItem).join("");
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
        activeFilter = filter === "admin" || filter === "transactions" ? filter : "all";
        ensureFilterButtons();
        renderNotificationBell(getSessionEmail());
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
                const opening = panel.classList.contains("hidden");
                panel.classList.toggle("hidden");
                notifBtn.setAttribute("aria-expanded", opening ? "true" : "false");
                if (opening) {
                    refreshNotificationsForUser(getSessionEmail());
                }
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
                    panel.classList.add("hidden");
                    const btn = document.getElementById("notifBtn");
                    if (btn) btn.setAttribute("aria-expanded", "false");
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
