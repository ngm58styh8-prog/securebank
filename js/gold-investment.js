(function() {
    "use strict";

    var username = requireAuth();
    if (!username) throw new Error("Not authenticated");

    var account = getAccount(username);
    ensureProfile(username, account);
    ensureGoldInvestment(account);
    syncAccountNotifications(username, account);

    var perfChart = null;
    var countdownTimer = null;

    function formatUsd(amount) {
        var n = Number(amount);
        if (isNaN(n)) n = 0;
        return "$" + n.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatDate(iso) {
        if (!iso) return "—";
        try {
            return new Date(iso).toLocaleString();
        } catch (e) {
            return iso;
        }
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function renderStats(gi) {
        gi = gi || account.goldInvestment;
        var balance = gi.active ? Number(gi.balance || gi.investedAmount || 0) : 0;
        setText("giGoldBalance", formatUsd(balance));
        setText("giCurrentInvestment", formatUsd(gi.investedAmount || 0));
        setText("giDailyReturn", formatUsd(gi.dailyReturn || 0));
        setText("giTotalEarned", formatUsd(gi.totalEarned || 0));
        setText("giStartDate", gi.startDate ? formatDate(gi.startDate) : "—");
        startNextCreditCountdown(gi.nextCreditAt);
    }

    function startNextCreditCountdown(nextCreditAt) {
        if (countdownTimer) clearInterval(countdownTimer);
        var el = document.getElementById("giNextCredit");
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

    function renderHistory(history) {
        history = history || [];
        var txBody = document.getElementById("goldTxBody");
        var profitBody = document.getElementById("goldProfitBody");
        if (!txBody || !profitBody) return;

        if (!history.length) {
            txBody.innerHTML = "<tr><td colspan=\"6\">No gold transactions yet.</td></tr>";
            profitBody.innerHTML = "<tr><td colspan=\"4\">No profit history yet.</td></tr>";
            renderPerformanceChart([]);
            return;
        }

        var cumulative = 0;
        var profitRows = [];
        history.slice().reverse().forEach(function(row) {
            cumulative += Number(row.amountCredited || row.dailyReturn || row.amount || 0);
            profitRows.push({ row: row, cumulative: cumulative });
        });
        profitRows.reverse();

        txBody.innerHTML = history.map(function(row) {
            return (
                "<tr>" +
                "<td>" + (row.investmentId || "—") + "</td>" +
                "<td>" + formatUsd(row.dailyReturn || row.amount) + "</td>" +
                "<td>" + formatUsd(row.amountCredited || row.amount) + "</td>" +
                "<td>" + formatDate(row.date || row.created_at) + "</td>" +
                "<td><span class=\"gold-status-badge\">" + (row.status || "completed") + "</span></td>" +
                "<td>" + (row.reference || "—") + "</td>" +
                "</tr>"
            );
        }).join("");

        profitBody.innerHTML = profitRows.map(function(entry) {
            var row = entry.row;
            return (
                "<tr>" +
                "<td>" + formatDate(row.date || row.creditDate || row.created_at) + "</td>" +
                "<td>" + formatUsd(row.dailyReturn || row.amount) + "</td>" +
                "<td>" + formatUsd(entry.cumulative) + "</td>" +
                "<td>" + (row.reference || "—") + "</td>" +
                "</tr>"
            );
        }).join("");

        renderPerformanceChart(profitRows);
    }

    function renderPerformanceChart(profitRows) {
        var canvas = document.getElementById("goldPerformanceChart");
        if (!canvas || typeof Chart === "undefined") return;

        var labels = profitRows.map(function(e) {
            var d = e.row.date || e.row.creditDate;
            return d ? new Date(d).toLocaleDateString() : "";
        });
        var data = profitRows.map(function(e) { return e.cumulative; });

        if (!labels.length) {
            labels = ["Start"];
            data = [0];
        }

        if (perfChart) perfChart.destroy();
        perfChart = new Chart(canvas, {
            type: "line",
            data: {
                labels: labels,
                datasets: [{
                    label: "Cumulative Profit",
                    data: data,
                    borderColor: "#d4af37",
                    backgroundColor: "rgba(212, 175, 55, 0.15)",
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3,
                    pointBackgroundColor: "#f5d77a"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: { color: "rgba(255,255,255,0.45)", maxTicksLimit: 8 },
                        grid: { color: "rgba(255,255,255,0.06)" }
                    },
                    y: {
                        ticks: { color: "rgba(255,255,255,0.45)" },
                        grid: { color: "rgba(255,255,255,0.06)" }
                    }
                }
            }
        });
    }

    function loadPlans() {
        return fetchGoldPlans().then(function(result) {
            if (!result || !result.ok) return;
            var select = document.getElementById("goldPlanSelect");
            var hint = document.getElementById("goldPlanHint");
            if (!select) return;

            var plans = (result.plans || []).filter(function(p) {
                return p.enabled !== false && p.paused !== true;
            });

            select.innerHTML = plans.map(function(p) {
                return "<option value=\"" + p.id + "\" data-min=\"" + p.minInvestment + "\" data-max=\"" + p.maxInvestment + "\" data-daily=\"" + p.dailyReturn + "\">" +
                    p.name + " — $" + Number(p.dailyReturn).toFixed(2) + "/day</option>";
            }).join("");

            function updateHint() {
                var opt = select.options[select.selectedIndex];
                if (!opt || !hint) return;
                hint.textContent = "Min $" + Number(opt.dataset.min).toLocaleString() +
                    " · Max $" + Number(opt.dataset.max).toLocaleString() +
                    " · Daily return $" + Number(opt.dataset.daily).toFixed(2);
            }
            select.addEventListener("change", updateHint);
            updateHint();
        });
    }

    function toggleEnrollSection(gi) {
        var section = document.getElementById("goldEnrollSection");
        if (!section) return;
        if (gi && gi.active && gi.status === "active") {
            section.classList.add("hidden");
        } else {
            section.classList.remove("hidden");
        }
    }

    function applyStatus(result) {
        if (!result || !result.ok) return;
        if (result.account) {
            Object.assign(account, result.account);
            saveAccount(username, account, { skipServerSync: true });
        } else if (result.goldInvestment) {
            account.goldInvestment = result.goldInvestment;
            if (result.cash != null) account.cash = result.cash;
            saveAccount(username, account, { skipServerSync: true });
        }
        renderStats(account.goldInvestment);
        toggleEnrollSection(account.goldInvestment);

        if (result.credited) {
            var toast = document.getElementById("goldCreditToast");
            var text = document.getElementById("goldCreditToastText");
            if (text) {
                text.textContent = "Your Gold Investment generated today's return of " +
                    formatUsd(result.creditAmount) + ".";
            }
            if (toast) {
                toast.classList.remove("hidden");
                toast.classList.add("visible");
                setTimeout(function() { toast.classList.remove("visible"); }, 4500);
            }
            if (typeof renderNotificationBell === "function") {
                renderNotificationBell(account);
            }
        }
    }

    function refreshPage() {
        fetchGoldStatus(username).then(function(statusResult) {
            applyStatus(statusResult);
            return fetchGoldHistory(username);
        }).then(function(historyResult) {
            if (historyResult && historyResult.ok) {
                renderHistory(historyResult.history || []);
            }
        }).catch(function() {});
    }

    function initEnrollForm() {
        var form = document.getElementById("goldEnrollForm");
        if (!form) return;
        form.addEventListener("submit", function(e) {
            e.preventDefault();
            var errEl = document.getElementById("goldEnrollError");
            var planId = document.getElementById("goldPlanSelect").value;
            var amount = Number(document.getElementById("goldInvestAmount").value);
            if (errEl) errEl.classList.add("hidden");

            enrollGoldInvestment(username, planId, amount).then(function(result) {
                if (!result || !result.ok) {
                    if (errEl) {
                        errEl.textContent = (result && result.error) || "Enrollment failed.";
                        errEl.classList.remove("hidden");
                    }
                    return;
                }
                if (result.account) {
                    Object.assign(account, result.account);
                    saveAccount(username, account, { skipServerSync: true });
                }
                renderStats(account.goldInvestment);
                toggleEnrollSection(account.goldInvestment);
                refreshPage();
            });
        });
    }

    function initUI() {
        document.getElementById("logoutBtn").addEventListener("click", logout);
        if (typeof initNotificationBell === "function") initNotificationBell();
        if (typeof initThemeToggle === "function") initThemeToggle();
        var toggle = document.getElementById("sidebarToggle");
        var sidebar = document.getElementById("gvSidebar");
        if (toggle && sidebar) {
            toggle.addEventListener("click", function() {
                sidebar.classList.toggle("open");
            });
        }
    }

    renderStats(account.goldInvestment);
    toggleEnrollSection(account.goldInvestment);
    loadPlans();
    initEnrollForm();
    initUI();
    refreshPage();
    setInterval(refreshPage, 60000);
})();
