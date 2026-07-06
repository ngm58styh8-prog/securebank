(function() {
    const sections = [
        { id: "section-dashboard", label: "Dashboard", icon: "📊" },
        { id: "section-users", label: "Users", icon: "👤" },
        { id: "section-activity", label: "Activity", icon: "📡" },
        { id: "section-approvals", label: "Approvals", icon: "✅" },
        { id: "section-support", label: "Support", icon: "💬" },
        { id: "section-settings", label: "Settings", icon: "⚙️" }
    ];

    function scrollToSection(id) {
        const el = document.getElementById(id);
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
        const sidebar = document.getElementById("adminSidebar");
        const overlay = document.getElementById("adminSidebarOverlay");
        if (sidebar) sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("open");
    }

    function openSidebar() {
        const sidebar = document.getElementById("adminSidebar");
        const overlay = document.getElementById("adminSidebarOverlay");
        if (sidebar) sidebar.classList.add("open");
        if (overlay) overlay.classList.add("open");
    }

    function updateBadges() {
        const pendingTransfers = document.getElementById("pendingTransferCount");
        const pendingDeposits = document.getElementById("pendingDepositCount");
        const openSupport = document.getElementById("openSupportCount");
        let total = 0;
        if (pendingTransfers) total += parseInt(pendingTransfers.textContent, 10) || 0;
        if (pendingDeposits) total += parseInt(pendingDeposits.textContent, 10) || 0;
        if (openSupport) total += parseInt(openSupport.textContent, 10) || 0;

        const badge = document.getElementById("adminApprovalsBadge");
        if (badge) {
            badge.textContent = String(total);
            badge.style.display = total > 0 ? "inline-block" : "none";
        }
    }

    function buildNav() {
        const sidebarNav = document.getElementById("adminSidebarNav");
        const bottomNav = document.getElementById("adminBottomNav");
        if (!sidebarNav || !bottomNav) return;

        sections.forEach(function(s) {
            const sideBtn = document.createElement("button");
            sideBtn.type = "button";
            sideBtn.className = "admin-nav-btn" + (s.id === "section-dashboard" ? " active" : "");
            sideBtn.dataset.section = s.id;
            sideBtn.innerHTML = "<span>" + s.icon + "</span><span>" + s.label + "</span>";
            if (s.id === "section-approvals") {
                sideBtn.innerHTML += '<span class="admin-nav-badge" id="adminApprovalsBadge" style="display:none">0</span>';
            }
            sideBtn.addEventListener("click", function() { scrollToSection(s.id); });
            sidebarNav.appendChild(sideBtn);

            const bottomBtn = document.createElement("button");
            bottomBtn.type = "button";
            bottomBtn.className = "admin-bottom-btn" + (s.id === "section-dashboard" ? " active" : "");
            bottomBtn.dataset.section = s.id;
            bottomBtn.innerHTML = '<span class="admin-bottom-icon">' + s.icon + '</span><span>' + s.label + "</span>";
            bottomBtn.addEventListener("click", function() { scrollToSection(s.id); });
            bottomNav.appendChild(bottomBtn);
        });
    }

    document.addEventListener("DOMContentLoaded", function() {
        buildNav();

        const menuBtn = document.getElementById("adminMenuBtn");
        const overlay = document.getElementById("adminSidebarOverlay");
        if (menuBtn) menuBtn.addEventListener("click", openSidebar);
        if (overlay) overlay.addEventListener("click", closeSidebar);

        updateBadges();
        setInterval(updateBadges, 3000);

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) setActiveNav(entry.target.id);
                });
            }, { rootMargin: "-30% 0px -55% 0px", threshold: 0.01 });

            sections.forEach(function(s) {
                const el = document.getElementById(s.id);
                if (el) observer.observe(el);
            });
        }
    });

    window.showAdminToast = function(message, type) {
        const existing = document.querySelector(".admin-toast");
        if (existing) existing.remove();
        const toast = document.createElement("div");
        toast.className = "admin-toast " + (type || "info");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 3200);
    };
})();
