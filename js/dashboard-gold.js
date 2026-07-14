(function() {
    "use strict";

    var countdownTimer = null;
    var lastCreditShown = "";

    function formatUsd(amount) {
        var n = Number(amount);
        if (isNaN(n)) n = 0;
        return "$" + n.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function getGi() {
        if (typeof account === "undefined" || !account) return null;
        if (typeof ensureGoldInvestment === "function") ensureGoldInvestment(account);
        return account.goldInvestment || null;
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function renderGoldCard(gi, plan) {
        gi = gi || getGi();
        if (!gi) return;

        var balance = gi.active
            ? Number(gi.balance || gi.investedAmount || 0)
            : 0;
        var daily = Number(gi.dailyReturn || (plan && plan.dailyReturn) || 0);
        var today = Number(gi.todayReturn || 0);
        var profit = Number(gi.totalEarned || 0);

        setText("goldBalanceValue", formatUsd(balance));
        setText("goldTodayReturn", formatUsd(today));
        setText("goldDailyReturn", formatUsd(daily));
        setText("goldTotalProfit", formatUsd(profit));
        setText("goldActivePlan", gi.active && gi.planName ? gi.planName : "No active plan");

        startCountdown(gi.nextCreditAt);
    }

    function startCountdown(nextCreditAt) {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }

        var el = document.getElementById("goldCountdown");
        if (!el) return;

        function tick() {
            if (!nextCreditAt) {
                el.textContent = "—";
                return;
            }
            var diff = new Date(nextCreditAt).getTime() - Date.now();
            if (diff <= 0) {
                el.textContent = "Crediting soon…";
                return;
            }
            var h = Math.floor(diff / 3600000);
            var m = Math.floor((diff % 3600000) / 60000);
            var s = Math.floor((diff % 60000) / 1000);
            el.textContent =
                String(h).padStart(2, "0") + ":" +
                String(m).padStart(2, "0") + ":" +
                String(s).padStart(2, "0");
        }

        tick();
        countdownTimer = setInterval(tick, 1000);
    }

    function showCreditToast(amount) {
        var toast = document.getElementById("goldCreditToast");
        var text = document.getElementById("goldCreditToastText");
        var card = document.getElementById("goldInvestmentCard");
        if (text) {
            text.textContent = amount
                ? "Your Gold Investment generated today's return of " + formatUsd(amount) + "."
                : "Your Gold Investment generated today's return.";
        }
        if (toast) {
            toast.classList.remove("hidden");
            toast.classList.add("visible");
            setTimeout(function() {
                toast.classList.remove("visible");
            }, 4500);
        }
        if (card) {
            card.classList.add("gv-credit-flash");
            setTimeout(function() {
                card.classList.remove("gv-credit-flash");
            }, 1400);
        }
        if (typeof renderNotificationBell === "function" && typeof account !== "undefined") {
            renderNotificationBell(account);
        }
    }

    function applyGoldStatusResult(result) {
        if (!result || !result.ok) return;

        if (result.account && typeof account !== "undefined") {
            Object.assign(account, result.account);
            if (typeof saveState === "function") saveState();
        } else if (result.goldInvestment && typeof account !== "undefined") {
            account.goldInvestment = result.goldInvestment;
            if (result.cash != null) account.cash = result.cash;
            if (typeof saveState === "function") saveState();
        }

        renderGoldCard(result.goldInvestment || getGi(), result.plan);

        if (result.credited && result.creditAmount) {
            var key = (result.goldInvestment && result.goldInvestment.lastCreditDate) || "today";
            if (lastCreditShown !== key) {
                lastCreditShown = key;
                showCreditToast(result.creditAmount);
                if (typeof updateUI === "function") updateUI();
            }
        }
    }

    function refreshGoldStatus() {
        if (typeof fetchGoldStatus !== "function" || typeof username === "undefined") return;
        fetchGoldStatus(username).then(applyGoldStatusResult).catch(function() {});
    }

    window.initGoldDashboard = function() {
        var gi = getGi();
        renderGoldCard(gi, null);
        refreshGoldStatus();
        setInterval(refreshGoldStatus, 60000);
    };

    document.addEventListener("DOMContentLoaded", function() {
        if (document.getElementById("goldInvestmentCard")) {
            setTimeout(function() {
                if (typeof initGoldDashboard === "function") initGoldDashboard();
            }, 400);
        }
    });
})();
