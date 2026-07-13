(function() {
    "use strict";

    var sections = [
        { id: "section-dashboard", label: "Dashboard", icon: "📊", bottom: true },
        { id: "section-users", label: "Users", icon: "👤", bottom: true },
        { id: "section-activity", label: "Transactions", icon: "💳", bottom: true },
        { id: "section-send-money", label: "Send Money", icon: "⇄", bottom: false },
        { id: "section-approvals", label: "Approvals", icon: "✅", bottom: false },
        { id: "section-support", label: "Support", icon: "💬", bottom: false },
        { id: "section-settings", label: "Settings", icon: "⚙️", bottom: true }
    ];

    function scrollToSection(id) {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveNav(id);
        closeSidebar();
    }

    function setActiveNav(id) {
        document.querySelectorAll(".admin-nav-btn, .admin-bottom-btn").forEach(function(btn) {
            btn.classList.toggle("active", btn.dataset.section === id);
        });
    }

    function closeSidebar() {
        var sidebar = document.getElementById("adminSidebar");
        var overlay = document.getElementById("adminSidebarOverlay");
        if (sidebar) sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("open");
    }

    function openSidebar() {
        var sidebar = document.getElementById("adminSidebar");
        var overlay = document.getElementById("adminSidebarOverlay");
        if (sidebar) sidebar.classList.add("open");
        if (overlay) overlay.classList.add("open");
    }

    function updateBadges() {
        var pendingTransfers = document.getElementById("pendingTransferCount");
        var pendingDeposits = document.getElementById("pendingDepositCount");
        var openSupport = document.getElementById("openSupportCount");
        var total = 0;
        if (pendingTransfers) total += parseInt(pendingTransfers.textContent, 10) || 0;
        if (pendingDeposits) total += parseInt(pendingDeposits.textContent, 10) || 0;
        if (openSupport) total += parseInt(openSupport.textContent, 10) || 0;

        var badge = document.getElementById("adminApprovalsBadge");
        if (badge) {
            badge.textContent = String(total);
            badge.style.display = total > 0 ? "inline-block" : "none";
        }

        var notifDot = document.getElementById("adminNotifDot");
        if (notifDot) {
            notifDot.classList.toggle("visible", total > 0);
        }
    }

    function buildSidebarNav() {
        var sidebarNav = document.getElementById("adminSidebarNav");
        if (!sidebarNav) return;

        sections.forEach(function(s) {
            var sideBtn = document.createElement("button");
            sideBtn.type = "button";
            sideBtn.className = "admin-nav-btn" + (s.id === "section-dashboard" ? " active" : "");
            sideBtn.dataset.section = s.id;
            sideBtn.innerHTML = "<span>" + s.icon + "</span><span>" + s.label + "</span>";
            if (s.id === "section-approvals") {
                sideBtn.innerHTML += '<span class="admin-nav-badge" id="adminApprovalsBadge" style="display:none">0</span>';
            }
            sideBtn.addEventListener("click", function() { scrollToSection(s.id); });
            sidebarNav.appendChild(sideBtn);
        });
    }

    function buildBottomNav() {
        var bottomNav = document.getElementById("adminBottomNav");
        if (!bottomNav) return;

        bottomNav.className = "admin-bottom-nav luxury-bottom-nav";
        bottomNav.innerHTML = "";

        var bottomItems = [
            { id: "section-dashboard", label: "Dashboard", icon: "📊" },
            { id: "section-users", label: "Users", icon: "👤" },
            null,
            { id: "section-activity", label: "Transactions", icon: "💳" },
            { id: "section-settings", label: "Settings", icon: "⚙️" }
        ];

        bottomItems.forEach(function(item, index) {
            if (item === null) {
                var wrap = document.createElement("div");
                wrap.className = "admin-bottom-fab-wrap";
                wrap.innerHTML =
                    '<button type="button" class="admin-bottom-fab" id="adminQuickFab" aria-label="Quick actions">+</button>' +
                    '<span class="admin-bottom-fab-label">Quick</span>';
                bottomNav.appendChild(wrap);
                return;
            }

            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "admin-bottom-btn" + (item.id === "section-dashboard" ? " active" : "");
            btn.dataset.section = item.id;
            btn.innerHTML = '<span class="admin-bottom-icon">' + item.icon + '</span><span>' + item.label + "</span>";
            btn.addEventListener("click", function() { scrollToSection(item.id); });
            bottomNav.appendChild(btn);
        });

        var fab = document.getElementById("adminQuickFab");
        if (fab) {
            fab.addEventListener("click", function() {
                var quick = document.getElementById("adminQuickActions");
                if (quick) quick.scrollIntoView({ behavior: "smooth", block: "center" });
            });
        }
    }

    function getUserStatusBadge(user) {
        if (user.withdrawalsFrozen) {
            return { label: "Suspended", cls: "suspended" };
        }
        if (user.emailVerified && user.verificationStatus === "Verified") {
            return { label: "Verified", cls: "verified" };
        }
        if (!user.accountComplete || !user.emailVerified || user.verificationStatus === "Pending") {
            return { label: "Pending", cls: "pending" };
        }
        return { label: "Active", cls: "active" };
    }

    function formatJoinDate(user) {
        if (user.memberSince) {
            try {
                return new Date(user.memberSince).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", year: "numeric"
                });
            } catch (e) { /* ignore */ }
        }
        if (user.lastLoginAt) {
            try {
                return new Date(user.lastLoginAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", year: "numeric"
                });
            } catch (e) { /* ignore */ }
        }
        return "—";
    }

    function getInitials(name, email) {
        var source = (name || email || "U").trim();
        var parts = source.split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
        }
        return source.charAt(0).toUpperCase();
    }

    function escapeHtml(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function renderRecentUsers() {
        var list = document.getElementById("adminRecentUsersList");
        if (!list || typeof getAllUsersSummary !== "function") return;

        var users = getManageableUsersSummary().slice().sort(function(a, b) {
            var aTime = a.memberSince ? new Date(a.memberSince).getTime() : 0;
            var bTime = b.memberSince ? new Date(b.memberSince).getTime() : 0;
            return bTime - aTime;
        }).slice(0, 5);

        if (!users.length) {
            list.innerHTML = '<div class="admin-recent-empty">No registered users yet.</div>';
            return;
        }

        list.innerHTML = users.map(function(user) {
            var badge = getUserStatusBadge(user);
            return (
                '<div class="admin-recent-row admin-recent-row-selectable" data-email="' + escapeHtml(user.email) + '" role="button" tabindex="0" aria-label="Select ' + escapeHtml(user.name) + '">' +
                '<div class="admin-recent-avatar">' + escapeHtml(getInitials(user.name, user.email)) + '</div>' +
                '<div class="admin-recent-info">' +
                '<strong>' + escapeHtml(user.name) + '</strong>' +
                '<span>' + escapeHtml(user.email) + '</span>' +
                '</div>' +
                '<span class="admin-recent-date">' + escapeHtml(formatJoinDate(user)) + '</span>' +
                '<span class="admin-status-badge ' + badge.cls + '">' + badge.label + '</span>' +
                '</div>'
            );
        }).join("");

        list.querySelectorAll(".admin-recent-row-selectable").forEach(function(row) {
            function pickUser() {
                var select = document.getElementById("profileUserSelect");
                if (select && row.dataset.email) {
                    select.value = row.dataset.email;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
                scrollToSection("section-users");
            }
            row.addEventListener("click", pickUser);
            row.addEventListener("keydown", function(e) {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pickUser();
                }
            });
        });
    }

    function initGlobalSearch() {
        var globalSearch = document.getElementById("adminGlobalSearch");
        var userSearch = document.getElementById("userSearchInput");
        if (!globalSearch || !userSearch) return;

        globalSearch.addEventListener("input", function() {
            userSearch.value = globalSearch.value;
            userSearch.dispatchEvent(new Event("input", { bubbles: true }));
            if (globalSearch.value.trim()) {
                scrollToSection("section-users");
            }
        });

        userSearch.addEventListener("input", function() {
            if (globalSearch.value !== userSearch.value) {
                globalSearch.value = userSearch.value;
            }
        });

        var filterBtn = document.getElementById("adminSearchFilter");
        if (filterBtn) {
            filterBtn.addEventListener("click", function() {
                scrollToSection("section-users");
                userSearch.focus();
            });
        }
    }

    function initQuickActions() {
        document.querySelectorAll(".admin-quick-card[data-section]").forEach(function(card) {
            card.addEventListener("click", function() {
                scrollToSection(card.dataset.section);
            });
        });

        var viewAll = document.getElementById("adminViewAllUsers");
        if (viewAll) {
            viewAll.addEventListener("click", function() {
                scrollToSection("section-users");
            });
        }
    }

    function initNotifications() {
        var btn = document.getElementById("adminNotifBtn");
        if (!btn) return;
        btn.addEventListener("click", function() {
            var pending = (parseInt(document.getElementById("pendingDepositCount").textContent, 10) || 0) +
                (parseInt(document.getElementById("pendingTransferCount").textContent, 10) || 0);
            if (pending > 0) {
                scrollToSection("section-approvals");
            } else {
                scrollToSection("section-settings");
            }
        });
    }

    function animateStatCards() {
        document.querySelectorAll(".admin-overview-grid .balance").forEach(function(el) {
            el.classList.remove("adm-counted");
            void el.offsetWidth;
            el.classList.add("adm-counted");
        });
    }

    function initDashboardRefresh() {
        renderRecentUsers();
        updateBadges();
        animateStatCards();
    }

    document.addEventListener("DOMContentLoaded", function() {
        buildSidebarNav();
        buildBottomNav();

        var menuBtn = document.getElementById("adminMenuBtn");
        var overlay = document.getElementById("adminSidebarOverlay");
        if (menuBtn) menuBtn.addEventListener("click", openSidebar);
        if (overlay) overlay.addEventListener("click", closeSidebar);

        initGlobalSearch();
        initQuickActions();
        initNotifications();
        initDashboardRefresh();

        setInterval(function() {
            updateBadges();
        }, 3000);

        setInterval(function() {
            renderRecentUsers();
        }, 4000);

        window.addEventListener("globalvest-accounts-changed", initDashboardRefresh);
        window.addEventListener("globalvest-registry-synced", initDashboardRefresh);

        if ("IntersectionObserver" in window) {
            var observer = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) setActiveNav(entry.target.id);
                });
            }, { rootMargin: "-30% 0px -55% 0px", threshold: 0.01 });

            sections.forEach(function(s) {
                var el = document.getElementById(s.id);
                if (el) observer.observe(el);
            });
        }
    });

    window.showAdminToast = function(message, type) {
        var existing = document.querySelector(".admin-toast");
        if (existing) existing.remove();
        var toast = document.createElement("div");
        toast.className = "admin-toast " + (type || "info");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 3200);
    };
})();
