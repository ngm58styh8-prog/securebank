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
        if (transferBtn) {
            transferBtn.addEventListener("click", function() {
                window.location.href = "/send-money";
            });
        }
    }

    function initInvestBtn() {
        const investBtn = document.getElementById("investQuickBtn") || document.getElementById("moreQuickBtn");
        if (investBtn && investBtn.id === "investQuickBtn") {
            investBtn.addEventListener("click", function() {
                window.location.href = "/exchange";
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
                    window.location.href = "/exchange";
                } else if (q && q.toLowerCase().indexOf("wallet") !== -1) {
                    window.location.href = "/wallet";
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

    var heroAnimToken = 0;
    var heroLastValue = null;

    function animateCounter(el, targetValue, prefix, suffix, from) {
        if (!el || isNaN(targetValue)) return;
        const token = ++heroAnimToken;
        const duration = 700;
        const start = performance.now();
        from = from == null || isNaN(from) ? 0 : from;

        function frame(now) {
            /* Stop if a newer update started or the user hid balances. */
            if (token !== heroAnimToken || document.body.classList.contains("balances-hidden")) return;
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
            const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            /* Unchanged value: just keep the text; changed value: count from the previous value, not from 0. */
            if (reduce || heroLastValue === amount) {
                heroAnimToken++;
                el.textContent = formatted;
            } else {
                animateCounter(el, amount, "$", "", heroLastValue);
            }
            heroLastValue = amount;
            return;
        }
        heroAnimToken++;
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
    });
})();
