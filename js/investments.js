(function() {
    "use strict";

    var username = null;
    var portfolio = null;
    var quotes = {};

    function money(n) {
        var x = Number(n);
        if (isNaN(x)) x = 0;
        return "$" + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatLocal(iso) {
        if (!iso) return "—";
        try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    }

    function countdown(iso) {
        if (!iso) return "—";
        var ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return "Due now";
        var h = Math.floor(ms / 3600000);
        var m = Math.floor((ms % 3600000) / 60000);
        return h + "h " + m + "m";
    }

    function projectedDaily(plan, amount) {
        if (!plan) return 0;
        amount = Number(amount) || 0;
        if (plan.returnType === "fixed") return Number(plan.dailyReturnFixed) || 0;
        return Math.round((amount * (Number(plan.dailyReturnPercent) || 0)) / 100 * 100) / 100;
    }

    function renderSummary(summary) {
        var grid = document.getElementById("invSummaryGrid");
        if (!grid || !summary) return;
        grid.innerHTML =
            card("Total simulated invested", money(summary.totalSimulatedInvestmentUsd)) +
            card("Total simulated earnings", money(summary.totalSimulatedEarningsUsd)) +
            card("Active", summary.activeCount) +
            card("Completed", summary.completedCount) +
            card("Next credit", formatLocal(summary.nextSimulationCreditAt));
        var note = document.getElementById("invEducationalLabel");
        if (note && summary.educationalLabel) note.textContent = summary.educationalLabel;
    }

    function card(label, value) {
        return '<article class="inv-card gv-glass"><div class="label">' + label +
            '</div><div class="value">' + value + "</div></article>";
    }

    function renderPositions(positions) {
        var grid = document.getElementById("invPositionGrid");
        if (!grid) return;
        if (!positions || !positions.length) {
            grid.innerHTML = "<p>No active simulations yet. Choose an asset below to invest.</p>";
            return;
        }
        grid.innerHTML = positions.filter(function(p) { return p.status === "active"; }).map(function(p) {
            var link = p.href ? ('<a class="deposit-btn" href="' + p.href + '">Manage</a>') : "";
            return '<article class="inv-card inv-asset-card gv-glass">' +
                "<h4>" + (p.assetSymbol || "") + " " + (p.assetName || p.assetId) + "</h4>" +
                "<p>Invested: " + money(p.investedAmount) + "</p>" +
                "<p>Simulated daily: " + money(p.dailySimulatedReturn) + "</p>" +
                "<p>Total simulated earnings: " + money(p.totalSimulatedEarned) + "</p>" +
                "<p>Next credit: " + countdown(p.nextCreditAt) + " (" + formatLocal(p.nextCreditAt) + ")</p>" +
                link + "</article>";
        }).join("");
    }

    function renderAssetGrid(assets) {
        var grid = document.getElementById("invAssetGrid");
        if (!grid || !assets) return;
        grid.innerHTML = assets.map(function(a) {
            if (a.id === "gold") {
                return '<article class="inv-card inv-asset-card gv-glass">' +
                    "<h4>🟨 Gold (XAU)</h4><p class=\"price\">Legacy Gold plan</p>" +
                    '<a class="deposit-btn" href="gold-investment.html">Invest Now</a></article>';
            }
            var q = quotes[a.id];
            var priceVal = q && (q.priceUsd != null ? q.priceUsd : q.price);
            var price = priceVal != null ? money(priceVal) : "Price unavailable";
            return '<article class="inv-card inv-asset-card gv-glass" data-asset="' + a.id + '">' +
                "<h4>" + a.name + " (" + a.symbol + ")</h4>" +
                '<p class="price">' + price + "</p>" +
                '<button type="button" class="deposit-btn inv-invest-btn" data-asset="' + a.id + '">Invest Now</button></article>';
        }).join("");
        grid.querySelectorAll(".inv-invest-btn").forEach(function(btn) {
            btn.addEventListener("click", function() { openDialog(btn.dataset.asset); });
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
            : "Market price unavailable — simulation uses USD allocation only.";

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

    function updateProjections() {
        var sel = document.getElementById("invPlanSelect");
        var amount = Number(document.getElementById("invAmount").value) || 0;
        if (!sel || !sel.selectedOptions.length) return;
        var plan = JSON.parse(sel.selectedOptions[0].getAttribute("data-plan"));
        var daily = projectedDaily(plan, amount);
        var duration = Number(plan.durationDays) || 365;
        document.getElementById("invProjectedDaily").textContent =
            "Projected simulated daily return: " + money(daily) + " (not guaranteed).";
        document.getElementById("invProjectedTotal").textContent =
            "Projected simulated total over " + duration + " days: " + money(daily * duration) + " (estimate only).";
        document.getElementById("invNextCredit").textContent =
            "Simulation credits run every 24 hours (UTC storage, shown in your local time when active).";
    }

    function loadQuotes() {
        if (!window.GVMarketData || !GVMarketData.loadAll) return Promise.resolve();
        return GVMarketData.loadAll(false).then(function(data) {
            quotes = data && data.quotes ? data.quotes : (data || {});
        }).catch(function() { quotes = {}; });
    }

    function refresh() {
        return fetchInvestmentPortfolio(username).then(function(data) {
            if (!data.ok) throw new Error(data.error || "Could not load investments.");
            portfolio = data;
            renderSummary(data.summary);
            renderPositions(data.positions);
            return loadQuotes().then(function() {
                renderAssetGrid(data.assets || []);
            });
        });
    }

    document.addEventListener("DOMContentLoaded", function() {
        username = requireAuth();
        if (!username) return;

        document.getElementById("invDialogClose").addEventListener("click", function() {
            document.getElementById("invDialog").classList.add("hidden");
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

        refresh().catch(function(e) {
            alert(e.message || "Failed to load investments.");
        });
        setInterval(function() {
            if (portfolio && portfolio.positions) renderPositions(portfolio.positions);
        }, 60000);
    });
})();
