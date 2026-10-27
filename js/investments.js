(function() {
    "use strict";

    var username = null;
    var portfolio = null;
    var quotes = {};
    var historyEvents = [];
    var chartInstances = [];
    var countdownTimer = null;
    var refreshInFlight = false;
    var lastDueRefreshAt = 0;

    var icon = window.InvestmentAssetVisuals ? window.InvestmentAssetVisuals.iconHtml : function() { return ""; };
    var assetMeta = window.InvestmentAssetVisuals ? window.InvestmentAssetVisuals.meta : function(id, n, s) {
        return { id: id, label: n || id, symbol: s || id };
    };

    function money(n) {
        var x = Number(n);
        if (isNaN(x)) x = 0;
        return "$" + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatLocal(iso) {
        if (!iso) return "—";
        try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    }

    function parseCreditTime(iso) {
        if (!iso) return NaN;
        var t = new Date(iso).getTime();
        return isNaN(t) ? NaN : t;
    }

    function countdownParts(iso) {
        if (!iso) return { text: "—", due: true };
        var ms = parseCreditTime(iso) - Date.now();
        if (isNaN(ms)) return { text: "—", due: true };
        if (ms <= 0) return { text: "Due now", due: true };
        var totalSec = Math.floor(ms / 1000);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        function pad(v) { return v < 10 ? "0" + v : String(v); }
        return { text: pad(h) + ":" + pad(m) + ":" + pad(s), due: false };
    }

    function projectedDaily(plan, amount) {
        if (!plan) return 0;
        amount = Number(amount) || 0;
        if (plan.returnType === "fixed") return Number(plan.dailyReturnFixed) || 0;
        return Math.round((amount * (Number(plan.dailyReturnPercent) || 0)) / 100 * 100) / 100;
    }

    function destroyCharts() {
        chartInstances.forEach(function(c) {
            try { c.destroy(); } catch (e) { /* ignore */ }
        });
        chartInstances = [];
    }

    function sparklineDataFromHistory(assetKey, field) {
        var points = [];
        var cum = 0;
        historyEvents.filter(function(ev) {
            return ev.assetId === assetKey || (assetKey === "gold" && ev.source === "gold");
        }).slice().reverse().forEach(function(ev) {
            cum += Number(ev.amount || 0);
            points.push(cum);
        });
        if (points.length < 2) return null;
        return points;
    }

    function makeSparkline(canvas, data, color) {
        if (!canvas || typeof Chart === "undefined" || !data || data.length < 2) return;
        var ctx = canvas.getContext("2d");
        var ch = new Chart(ctx, {
            type: "line",
            data: {
                labels: data.map(function(_, i) { return i; }),
                datasets: [{
                    data: data,
                    borderColor: color || "#00E89B",
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: "rgba(0, 232, 155, 0.12)",
                    pointRadius: 0,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                },
                animation: false
            }
        });
        chartInstances.push(ch);
    }

    function makeBarSpark(canvas, count, color) {
        if (!canvas || typeof Chart === "undefined") return;
        var n = Math.max(1, Math.min(12, Number(count) || 1));
        var bars = [];
        for (var i = 0; i < n; i++) bars.push(0.4 + (i / n) * 0.6);
        var ctx = canvas.getContext("2d");
        var ch = new Chart(ctx, {
            type: "bar",
            data: {
                labels: bars.map(function(_, i) { return i; }),
                datasets: [{
                    data: bars,
                    backgroundColor: color || "#00E89B",
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } },
                animation: false
            }
        });
        chartInstances.push(ch);
    }

    function statIconSvg(name) {
        if (name === "coin") {
            return '<svg class="inv-stat-icon inv-stat-icon-gold" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h6M9 14h6"/></svg>';
        }
        if (name === "bars") {
            return '<svg class="inv-stat-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18V8M10 18V4M16 18v-6M22 18V10"/></svg>';
        }
        if (name === "clock") {
            return '<svg class="inv-stat-icon inv-stat-icon-gold" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
        }
        return '<svg class="inv-stat-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-8"/></svg>';
    }

    function renderSummary(summary) {
        var grid = document.getElementById("invSummaryGrid");
        if (!grid || !summary) return;
        var nextIso = summary.nextSimulationCreditAt;
        var cd = countdownParts(nextIso);
        grid.innerHTML =
            statCard("invested", "Total Invested", money(summary.totalSimulatedInvestmentUsd), "line", null) +
            statCard("earnings", "Total Earnings", money(summary.totalSimulatedEarningsUsd), "growth", null) +
            statCard("active", "Active Investments", String(summary.activeCount != null ? summary.activeCount : 0), "bars", null) +
            statCard("next", "Next Credit", cd.text, "clock", formatLocal(nextIso), nextIso);

        var investedHist = aggregateInvestedHistory();
        var earnHist = aggregateEarningsHistory();
        var canvases = grid.querySelectorAll("canvas[data-spark]");
        canvases.forEach(function(cv) {
            var kind = cv.getAttribute("data-spark");
            if (kind === "invested" && investedHist) makeSparkline(cv, investedHist, "#00E89B");
            else if (kind === "earnings" && earnHist) makeSparkline(cv, earnHist, "#8BFFD0");
            else if (kind === "bars") makeBarSpark(cv, summary.activeCount, "#00E89B");
        });
    }

    function aggregateInvestedHistory() {
        if (!portfolio || !portfolio.positions || !portfolio.positions.length) return null;
        var byDate = [];
        portfolio.positions.forEach(function(p) {
            if (p.startDate) byDate.push({ t: new Date(p.startDate).getTime(), v: Number(p.investedAmount || 0) });
        });
        byDate.sort(function(a, b) { return a.t - b.t; });
        if (byDate.length < 2) return null;
        var running = 0;
        return byDate.map(function(row) {
            running += row.v;
            return running;
        });
    }

    function aggregateEarningsHistory() {
        var pts = [];
        var cum = 0;
        historyEvents.slice().reverse().forEach(function(ev) {
            cum += Number(ev.amount || 0);
            pts.push(cum);
        });
        return pts.length >= 2 ? pts : null;
    }

    function statCard(id, label, value, spark, sub, nextIso) {
        var subHtml = sub ? '<p class="inv-stat-sub" title="Scheduled calculation time">' + sub + "</p>" : "";
        var clockExtra = id === "next"
            ? '<div class="inv-stat-clock">' + statIconSvg("clock") +
                '<span class="inv-countdown-lg inv-live-countdown" data-next-credit="' + (nextIso || "") + '">' + value + "</span></div>"
            : "";
        var chartHtml = spark === "clock"
            ? ""
            : '<div class="inv-stat-chart-wrap"><canvas data-spark="' + spark + '" aria-hidden="true"></canvas></div>';
        return '<article class="inv-stat-card" data-stat="' + id + '">' +
            '<div class="inv-stat-top"><span class="inv-stat-label">' + label + "</span>" +
            statIconSvg(spark === "growth" ? "coin" : spark === "bars" ? "bars" : spark === "clock" ? "clock" : "line") +
            "</div>" +
            (id === "next" ? clockExtra : '<div class="inv-stat-value">' + value + "</div>") +
            subHtml + chartHtml + "</article>";
    }

    function positionCardClass(p) {
        if (p.source === "gold" || p.assetId === "gold") return "inv-pos-gold";
        if (p.assetId === "eth") return "inv-pos-eth";
        return "";
    }

    function renderPositions(positions) {
        var grid = document.getElementById("invPositionGrid");
        var empty = document.getElementById("invPositionsEmpty");
        if (!grid) return;
        var active = (positions || []).filter(function(p) { return p.status === "active"; });
        if (!active.length) {
            grid.innerHTML = "";
            if (empty) empty.classList.remove("hidden");
            return;
        }
        if (empty) empty.classList.add("hidden");
        grid.innerHTML = active.map(function(p) {
            var m = assetMeta(p.assetId, p.assetName, p.assetSymbol);
            var cd = countdownParts(p.nextCreditAt);
            var cls = "inv-pos-card " + positionCardClass(p);
            var plan = p.planName ? ('<p class="inv-plan-name">Plan: ' + p.planName + "</p>") : "";
            return '<article class="' + cls + '" data-position-id="' + (p.id || "") + '">' +
                '<div class="inv-pos-head">' +
                '<div class="inv-pos-title-row">' + icon(p.assetId, 44, p.assetName, p.assetSymbol) +
                '<div><h3>' + (m.label || p.assetName) + '</h3><div class="inv-pos-symbol">' + (p.assetSymbol || m.symbol) + "</div></div></div>" +
                '<span class="inv-status-pill">' + (p.status || "Active") + "</span></div>" +
                '<div class="inv-pos-metrics">' +
                metric("Invested Amount", money(p.investedAmount)) +
                metric("Daily Earnings", money(p.dailySimulatedReturn)) +
                metric("Total Earnings", money(p.totalSimulatedEarned)) +
                metric("Next Credit", '<span class="inv-live-countdown" data-next-credit="' + (p.nextCreditAt || "") + '">' + cd.text + "</span>") +
                "</div>" + plan +
                '<div class="inv-pos-chart"><canvas data-pos-chart="' + (p.assetId || "") + '" aria-hidden="true"></canvas></div>' +
                '<button type="button" class="inv-manage-btn" data-manage=\'' + JSON.stringify(p).replace(/'/g, "&#39;") + "'>Manage</button></article>";
        }).join("");

        grid.querySelectorAll("canvas[data-pos-chart]").forEach(function(cv) {
            var key = cv.getAttribute("data-pos-chart");
            var series = sparklineDataFromHistory(key);
            var color = key === "gold" ? "#FFD166" : "#00E89B";
            if (series) makeSparkline(cv, series, color);
        });

        grid.querySelectorAll(".inv-manage-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                try {
                    openManage(JSON.parse(btn.getAttribute("data-manage")));
                } catch (e) { /* ignore */ }
            });
        });
    }

    function metric(label, value) {
        return '<div class="inv-metric"><label>' + label + '</label><span>' + value + "</span></div>";
    }

    function renderAssetScroll(assets) {
        var scroll = document.getElementById("invAssetScroll");
        if (!scroll || !assets) return;
        scroll.innerHTML = assets.map(function(a) {
            var m = assetMeta(a.id, a.name, a.symbol);
            if (a.id === "gold") {
                return '<a class="inv-asset-chip" role="listitem" href="gold-investment.html">' +
                    icon("gold", 40, m.label, m.symbol) +
                    '<div class="inv-asset-chip-name">Gold</div><div class="inv-asset-chip-sym">XAU</div></a>';
            }
            var plans = (portfolio.plans || []).filter(function(pl) {
                return pl.assetId === a.id && pl.enabled !== false && !pl.paused;
            });
            var unavailable = !plans.length;
            return '<button type="button" class="inv-asset-chip' + (unavailable ? " unavailable" : "") + '" role="listitem" data-asset="' + a.id + '"' +
                (unavailable ? ' disabled title="Unavailable"' : "") + ">" +
                icon(a.id, 40, a.name, a.symbol) +
                '<div class="inv-asset-chip-name">' + a.name + '</div><div class="inv-asset-chip-sym">' + a.symbol + "</div></button>";
        }).join("");

        scroll.querySelectorAll(".inv-asset-chip[data-asset]").forEach(function(chip) {
            chip.addEventListener("click", function() {
                if (chip.disabled) return;
                openDialog(chip.getAttribute("data-asset"));
            });
        });
    }

    function openDialog(assetId) {
        var dialog = document.getElementById("invDialog");
        if (!dialog) return;
        document.getElementById("invDialogAssetId").value = assetId;
        document.getElementById("invEnrollError").classList.add("hidden");
        var asset = (portfolio.assets || []).find(function(a) { return a.id === assetId; });
        document.getElementById("invDialogTitle").textContent = "Invest Now — " + (asset ? asset.name : assetId);
        var q = quotes[assetId];
        var pv = q && (q.priceUsd != null ? q.priceUsd : q.price);
        document.getElementById("invDialogPrice").textContent = pv != null
            ? "Current market price: " + money(pv)
            : "Market price unavailable — allocation is based on USD amount.";

        fetchAssetSimulationPlans(assetId).then(function(r) {
            var sel = document.getElementById("invPlanSelect");
            sel.innerHTML = (r.plans || []).map(function(p) {
                return '<option value="' + p.id + '" data-plan=\'' + JSON.stringify(p).replace(/'/g, "&#39;") + "'>" +
                    p.name + "</option>";
            }).join("");
            updateProjections();
        });
        dialog.classList.remove("hidden");
    }

    function openManage(position) {
        var dialog = document.getElementById("invManageDialog");
        var body = document.getElementById("invManageBody");
        var openBtn = document.getElementById("invManageOpenPage");
        if (!dialog || !body) return;
        var m = assetMeta(position.assetId, position.assetName, position.assetSymbol);
        document.getElementById("invManageTitle").textContent = m.label + " — Details";
        var related = historyEvents.filter(function(ev) {
            return ev.assetId === position.assetId || (position.source === "gold" && ev.source === "gold");
        }).slice(0, 8);
        var histHtml = related.length
            ? related.map(function(ev) {
                return "<div>" + formatLocal(ev.date) + " · " + money(ev.amount) + "</div>";
            }).join("")
            : "<p class=\"form-hint\">No earnings history yet.</p>";
        body.innerHTML =
            "<dl>" +
            row("Investment Principal", money(position.investedAmount)) +
            row("Investment Plan", position.planName || "—") +
            row("Start Date", formatLocal(position.startDate)) +
            row("Status", position.status || "Active") +
            row("Accumulated Earnings", money(position.totalSimulatedEarned)) +
            row("Next Calculation", formatLocal(position.nextCreditAt)) +
            row("Reference", position.reference || position.id || "—") +
            "</dl>" +
            '<div class="inv-manage-history"><strong>Earnings history</strong>' + histHtml + "</div>";

        if (position.href) {
            openBtn.classList.remove("hidden");
            openBtn.onclick = function() { window.location.href = position.href; };
        } else {
            openBtn.classList.add("hidden");
        }
        dialog.classList.remove("hidden");
    }

    function row(label, val) {
        return "<dt>" + label + "</dt><dd>" + val + "</dd>";
    }

    function updateProjections() {
        var sel = document.getElementById("invPlanSelect");
        var amount = Number(document.getElementById("invAmount").value) || 0;
        if (!sel || !sel.selectedOptions.length) return;
        var plan = JSON.parse(sel.selectedOptions[0].getAttribute("data-plan"));
        var daily = projectedDaily(plan, amount);
        var duration = Number(plan.durationDays) || 365;
        document.getElementById("invProjectedDaily").textContent =
            "Projected daily earnings: " + money(daily) + ". Returns are not guaranteed.";
        document.getElementById("invProjectedTotal").textContent =
            "Projected cumulative earnings over " + duration + " days: " + money(daily * duration) + " (estimate).";
        document.getElementById("invNextCredit").textContent =
            "Earnings are posted every 24 hours (UTC; shown in your local time when active).";
    }

    function tickCountdowns() {
        var anyDue = false;
        document.querySelectorAll(".inv-live-countdown").forEach(function(el) {
            var iso = el.getAttribute("data-next-credit");
            var cd = countdownParts(iso);
            el.textContent = cd.text;
            if (cd.due && iso) anyDue = true;
        });
        if (anyDue && !refreshInFlight) {
            var now = Date.now();
            if (now - lastDueRefreshAt > 15000) {
                lastDueRefreshAt = now;
                refresh();
            }
        }
    }

    function loadQuotes() {
        if (!window.GVMarketData || !GVMarketData.loadAll) return Promise.resolve();
        return GVMarketData.loadAll(false).then(function(data) {
            quotes = data && data.quotes ? data.quotes : (data || {});
        }).catch(function() { quotes = {}; });
    }

    function loadHistory() {
        return fetchCustomerInvestmentHistory(username, "all").then(function(r) {
            historyEvents = r.ok && r.events ? r.events : [];
        }).catch(function() { historyEvents = []; });
    }

    function showContent(show) {
        var loading = document.getElementById("invLoading");
        var content = document.getElementById("invContent");
        if (loading) loading.classList.toggle("hidden", show);
        if (content) content.classList.toggle("hidden", !show);
    }

    var linkedInvestmentHandled = false;

    // Deep link from confirmation emails and notifications: investments.html?investment=<id or reference>
    function openLinkedInvestment(positions) {
        if (linkedInvestmentHandled) return;
        var wanted = "";
        try {
            wanted = new URLSearchParams(window.location.search).get("investment") || "";
        } catch (e) { wanted = ""; }
        if (!wanted) return;
        linkedInvestmentHandled = true;
        var match = (positions || []).find(function(p) {
            return String(p.id) === wanted || String(p.reference || "") === wanted;
        });
        if (match) openManage(match);
    }

    function refresh() {
        if (refreshInFlight) return Promise.resolve();
        refreshInFlight = true;
        destroyCharts();
        return Promise.all([
            fetchInvestmentPortfolio(username),
            loadHistory()
        ]).then(function(results) {
            var data = results[0];
            if (!data.ok) throw new Error(data.error || "Could not load investments.");
            portfolio = data;
            var note = document.getElementById("invEducationalLabel");
            if (note && data.summary && data.summary.portfolioNotice) {
                note.textContent = data.summary.portfolioNotice;
            }
            renderSummary(data.summary);
            renderPositions(data.positions);
            openLinkedInvestment(data.positions);
            return loadQuotes().then(function() {
                renderAssetScroll(data.assets || []);
            });
        }).finally(function() {
            refreshInFlight = false;
        });
    }

    function initShell() {
        var logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", function() {
                clearSession();
                window.location.href = "login.html";
            });
        }
        var sidebarLogout = document.getElementById("gvSidebarLogout");
        if (sidebarLogout) {
            sidebarLogout.addEventListener("click", function() {
                clearSession();
                window.location.href = "login.html";
            });
        }
        if (typeof initNotificationBell === "function") initNotificationBell();
        var toggle = document.getElementById("sidebarToggle");
        var sidebar = document.getElementById("gvSidebar");
        if (toggle && sidebar) {
            toggle.addEventListener("click", function() { sidebar.classList.toggle("open"); });
        }
        var themeBtn = document.getElementById("themeToggle");
        if (themeBtn && !themeBtn.dataset.bound && typeof applyThemeToDocument === "function") {
            themeBtn.dataset.bound = "1";
            themeBtn.addEventListener("click", function() {
                applyThemeToDocument(document.body.dataset.theme === "dark" ? "light" : "dark");
            });
        }

        var explore = document.getElementById("invExploreBtn");
        if (explore) {
            explore.addEventListener("click", function() {
                var sec = document.getElementById("invInvestNowSection");
                if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        }
        var browse = document.getElementById("invBrowseAllBtn");
        if (browse) {
            browse.addEventListener("click", function() {
                var sec = document.getElementById("invInvestNowSection");
                if (sec) sec.scrollIntoView({ behavior: "smooth" });
                var wrap = document.querySelector(".inv-asset-scroll-wrap");
                if (wrap) wrap.scrollIntoView({ behavior: "smooth" });
            });
        }
    }

    document.addEventListener("DOMContentLoaded", function() {
        username = requireAuth();
        if (!username) return;
        initShell();

        document.getElementById("invDialogClose").addEventListener("click", function() {
            document.getElementById("invDialog").classList.add("hidden");
        });
        document.getElementById("invManageClose").addEventListener("click", function() {
            document.getElementById("invManageDialog").classList.add("hidden");
        });
        document.getElementById("invAmount").addEventListener("input", updateProjections);
        document.getElementById("invPlanSelect").addEventListener("change", updateProjections);

        document.getElementById("invEnrollForm").addEventListener("submit", function(e) {
            e.preventDefault();
            var planId = document.getElementById("invPlanSelect").value;
            var amount = Number(document.getElementById("invAmount").value);
            var err = document.getElementById("invEnrollError");
            enrollSimulationPlan(username, planId, amount).then(function(r) {
                if (!r.ok) {
                    err.textContent = r.error || "Enrollment failed.";
                    err.classList.remove("hidden");
                    return;
                }
                document.getElementById("invDialog").classList.add("hidden");
                refresh();
            });
        });

        showContent(false);
        function waitChart() {
            if (typeof Chart === "undefined") {
                setTimeout(waitChart, 50);
                return;
            }
            refresh().then(function() {
                showContent(true);
                tickCountdowns();
            }).catch(function(e) {
                showContent(true);
                alert(e.message || "Failed to load investments.");
            });
        }
        waitChart();

        countdownTimer = setInterval(tickCountdowns, 1000);
        setInterval(function() {
            refresh();
        }, 60000);
    });
})();
