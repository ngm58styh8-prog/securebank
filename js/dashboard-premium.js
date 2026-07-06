(function() {
    function isMarketOpen() {
        const now = new Date();
        const day = now.getUTCDay();
        const hour = now.getUTCHours();
        if (day === 0 || day === 6) return false;
        return hour >= 14 && hour < 21;
    }

    function updateMarketStatus() {
        const el = document.getElementById("marketStatus");
        if (!el) return;
        const open = isMarketOpen();
        el.classList.toggle("closed", !open);
        el.innerHTML = '<span class="dot"></span> ' + (open ? "Markets Open" : "Markets Closed");
    }

    function initMarketTabs() {
        const tabs = document.querySelectorAll(".gv-market-tab");
        const sections = document.querySelectorAll(".gv-market-section");
        if (!tabs.length) return;

        tabs.forEach(function(tab) {
            tab.addEventListener("click", function() {
                const target = tab.dataset.marketTab;
                tabs.forEach(function(t) { t.classList.toggle("active", t === tab); });
                sections.forEach(function(sec) {
                    sec.classList.toggle("hidden-panel", sec.dataset.marketSection !== target);
                });
            });
        });
    }

    function initOverviewTabs() {
        const tabs = document.querySelectorAll(".gv-overview-tab");
        const rows = document.querySelectorAll(".market-table tbody tr[data-market-type]");
        if (!tabs.length) return;

        tabs.forEach(function(tab) {
            tab.addEventListener("click", function() {
                const filter = tab.dataset.overviewTab;
                tabs.forEach(function(t) { t.classList.toggle("active", t === tab); });
                rows.forEach(function(row) {
                    const show = filter === "all" || row.dataset.marketType === filter;
                    row.style.display = show ? "" : "none";
                });
            });
        });
    }

    function initChartPeriodTabs() {
        const tabs = document.querySelectorAll(".gv-chart-tab");
        tabs.forEach(function(tab) {
            tab.addEventListener("click", function() {
                tabs.forEach(function(t) { t.classList.toggle("active", t === tab); });
            });
        });
    }

    function initWatchlist() {
        document.querySelectorAll(".gv-watch-chip").forEach(function(chip) {
            chip.addEventListener("click", function() {
                chip.classList.toggle("active");
            });
        });
    }

    function initSidebar() {
        const toggle = document.getElementById("sidebarToggle");
        const sidebar = document.getElementById("gvSidebar");
        if (toggle && sidebar) {
            toggle.addEventListener("click", function() {
                sidebar.classList.toggle("open");
            });
        }
    }

    function initTransferBtn() {
        const transferBtn = document.getElementById("transferQuickBtn");
        const withdrawBtn = document.getElementById("withdrawBtn");
        if (transferBtn && withdrawBtn) {
            transferBtn.addEventListener("click", function() {
                withdrawBtn.click();
            });
        }
    }

    function initInvestBtn() {
        const investBtn = document.getElementById("investQuickBtn");
        if (investBtn) {
            investBtn.addEventListener("click", function() {
                window.location.href = "exchange.html";
            });
        }
    }

    function initFab() {
        const fab = document.getElementById("gvFab");
        const depositBtn = document.getElementById("depositBtn");
        if (fab && depositBtn) {
            fab.addEventListener("click", function() {
                depositBtn.click();
            });
        }
    }

    function initSearch() {
        const btn = document.getElementById("searchBtn");
        if (btn) {
            btn.addEventListener("click", function() {
                const q = prompt("Search assets, transactions, or pages:");
                if (q && q.toLowerCase().indexOf("exchange") !== -1) {
                    window.location.href = "exchange.html";
                } else if (q && q.toLowerCase().indexOf("wallet") !== -1) {
                    window.location.href = "wallet.html";
                }
            });
        }
    }

    function initRipple() {
        document.querySelectorAll(".gv-action-card.gv-ripple").forEach(function(card) {
            card.addEventListener("click", function(e) {
                const rect = card.getBoundingClientRect();
                card.style.setProperty("--ripple-x", ((e.clientX - rect.left) / rect.width * 100) + "%");
                card.style.setProperty("--ripple-y", ((e.clientY - rect.top) / rect.height * 100) + "%");
            });
        });
    }

    function initHeroSparkChart() {
        const ctx = document.getElementById("heroSparkChart");
        if (!ctx || typeof Chart === "undefined") return;

        new Chart(ctx, {
            type: "line",
            data: {
                labels: ["", "", "", "", "", "", ""],
                datasets: [{
                    data: [9200000, 9450000, 9380000, 9620000, 9780000, 9910000, 10071996],
                    borderColor: "#3B82F6",
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    backgroundColor: "rgba(31, 107, 255, 0.12)",
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    function animateCounter(el, targetValue, prefix, suffix) {
        if (!el || isNaN(targetValue)) return;
        const duration = 900;
        const start = performance.now();
        const from = 0;

        function frame(now) {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            const val = from + (targetValue - from) * eased;
            el.textContent = (prefix || "") + val.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }) + (suffix || "");
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    window.animateHeroPortfolio = function(amount, formatted) {
        const el = document.getElementById("heroPortfolioValue");
        if (!el) return;
        if (typeof formatted === "string" && formatted.indexOf("$") === 0) {
            animateCounter(el, amount, "$", "");
            return;
        }
        el.textContent = formatted;
    };

    document.addEventListener("DOMContentLoaded", function() {
        updateMarketStatus();
        setInterval(updateMarketStatus, 60000);
        initMarketTabs();
        initOverviewTabs();
        initChartPeriodTabs();
        initWatchlist();
        initSidebar();
        initTransferBtn();
        initInvestBtn();
        initFab();
        initSearch();
        initRipple();
        initHeroSparkChart();
    });
})();
