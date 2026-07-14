(function() {
    "use strict";

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

    function adminNotify(msg, isError) {
        if (typeof window.adminToast === "function") {
            window.adminToast(msg, isError);
            return;
        }
        if (isError) console.warn(msg);
        else console.log(msg);
    }

    function renderPlans(plans) {
        var container = document.getElementById("adminGoldPlansList");
        if (!container) return;

        if (!plans || !plans.length) {
            container.innerHTML = "<p>No gold plans configured.</p>";
            return;
        }

        container.innerHTML = plans.map(function(plan) {
            var status = [];
            if (plan.enabled === false) status.push("Disabled");
            else if (plan.paused) status.push("Paused");
            else status.push("Active");

            return (
                "<article class=\"admin-gold-plan-card\" data-plan-id=\"" + plan.id + "\">" +
                "<h4>" + plan.name + "</h4>" +
                "<div class=\"admin-gold-plan-meta\">" +
                "Daily: " + formatUsd(plan.dailyReturn) + " · " +
                "Min " + formatUsd(plan.minInvestment) + " · " +
                "Max " + formatUsd(plan.maxInvestment) + " · " +
                plan.durationDays + " days · " +
                "<strong>" + status.join(", ") + "</strong>" +
                "</div>" +
                "<div class=\"admin-gold-plan-actions\">" +
                "<button type=\"button\" class=\"deposit-btn admin-gold-edit-btn\" data-id=\"" + plan.id + "\">Edit</button>" +
                (plan.paused
                    ? "<button type=\"button\" class=\"deposit-btn admin-gold-resume-btn\" data-id=\"" + plan.id + "\">Resume</button>"
                    : "<button type=\"button\" class=\"withdraw-btn admin-gold-pause-btn\" data-id=\"" + plan.id + "\">Pause</button>") +
                "<button type=\"button\" class=\"withdraw-btn admin-gold-toggle-btn\" data-id=\"" + plan.id + "\" data-enabled=\"" + (plan.enabled !== false) + "\">" +
                (plan.enabled === false ? "Enable" : "Disable") + "</button>" +
                "<button type=\"button\" class=\"withdraw-btn admin-gold-delete-btn\" data-id=\"" + plan.id + "\">Delete</button>" +
                "</div></article>"
            );
        }).join("");

        container.querySelectorAll(".admin-gold-edit-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                openPlanForm(plans.find(function(p) { return String(p.id) === btn.dataset.id; }));
            });
        });
        container.querySelectorAll(".admin-gold-pause-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                adminGoldPlanAction("pause-plan", btn.dataset.id).then(refreshGoldAdmin);
            });
        });
        container.querySelectorAll(".admin-gold-resume-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                adminGoldPlanAction("resume-plan", btn.dataset.id).then(refreshGoldAdmin);
            });
        });
        container.querySelectorAll(".admin-gold-toggle-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                var plan = plans.find(function(p) { return String(p.id) === btn.dataset.id; });
                if (!plan) return;
                var updated = Object.assign({}, plan, { enabled: plan.enabled === false });
                adminUpsertGoldPlan(updated).then(refreshGoldAdmin);
            });
        });
        container.querySelectorAll(".admin-gold-delete-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                if (!confirm("Delete this gold plan?")) return;
                var plan = plans.find(function(p) { return String(p.id) === btn.dataset.id; });
                if (!plan) return;
                adminUpsertGoldPlan(plan, { delete: true }).then(refreshGoldAdmin);
            });
        });
    }

    function openPlanForm(plan) {
        var card = document.getElementById("adminGoldPlanFormCard");
        var title = document.getElementById("adminGoldPlanFormTitle");
        if (!card) return;
        card.style.display = "block";
        if (title) title.textContent = plan ? "Edit Gold Plan" : "Create Gold Plan";
        document.getElementById("adminGoldPlanId").value = plan ? plan.id : "";
        document.getElementById("adminGoldPlanName").value = plan ? plan.name : "";
        document.getElementById("adminGoldDailyReturn").value = plan ? plan.dailyReturn : 1500;
        document.getElementById("adminGoldMinInvest").value = plan ? plan.minInvestment : 1000;
        document.getElementById("adminGoldMaxInvest").value = plan ? plan.maxInvestment : 1000000;
        document.getElementById("adminGoldDuration").value = plan ? plan.durationDays : 365;
        document.getElementById("adminGoldEnabled").checked = plan ? plan.enabled !== false : true;
    }

    function closePlanForm() {
        var card = document.getElementById("adminGoldPlanFormCard");
        if (card) card.style.display = "none";
    }

    function renderInvestors(investors) {
        var body = document.getElementById("adminGoldInvestorsBody");
        if (!body) return;
        if (!investors || !investors.length) {
            body.innerHTML = "<tr><td colspan=\"7\">No active gold investors found.</td></tr>";
            return;
        }
        body.innerHTML = investors.map(function(inv) {
            return (
                "<tr>" +
                "<td>" + (inv.userName || inv.userEmail) + "<br><small>" + inv.userEmail + "</small></td>" +
                "<td>" + (inv.planName || inv.planId || "—") + "</td>" +
                "<td>" + formatUsd(inv.investedAmount) + "</td>" +
                "<td>" + formatUsd(inv.totalEarned) + "</td>" +
                "<td>" + formatUsd(inv.dailyReturn) + "</td>" +
                "<td>" + (inv.status || "—") + "</td>" +
                "<td>" + formatDate(inv.startDate) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderPayoutLog(log) {
        var body = document.getElementById("adminGoldPayoutBody");
        if (!body) return;
        if (!log || !log.length) {
            body.innerHTML = "<tr><td colspan=\"6\">No payout history yet.</td></tr>";
            return;
        }
        body.innerHTML = log.map(function(row) {
            return (
                "<tr>" +
                "<td>" + formatDate(row.createdAt || row.date) + "</td>" +
                "<td>" + (row.reference || "—") + "</td>" +
                "<td>" + (row.userEmail || "—") + "</td>" +
                "<td>" + (row.planId || "—") + "</td>" +
                "<td>" + formatUsd(row.amount) + "</td>" +
                "<td>" + (row.status || "completed") + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function refreshGoldAdmin() {
        fetchGoldPlans().then(function(result) {
            if (result && result.ok) renderPlans(result.plans || []);
        });
        adminSearchGoldInvestors("").then(function(result) {
            if (result && result.ok) {
                renderInvestors(result.investors || []);
                renderPayoutLog(result.payoutLog || []);
            }
        });
    }

    function initGoldAdmin() {
        if (!document.getElementById("section-gold")) return;

        var newBtn = document.getElementById("adminGoldNewPlanBtn");
        if (newBtn) {
            newBtn.addEventListener("click", function() { openPlanForm(null); });
        }

        var cancelBtn = document.getElementById("adminGoldPlanCancelBtn");
        if (cancelBtn) cancelBtn.addEventListener("click", closePlanForm);

        var form = document.getElementById("adminGoldPlanForm");
        if (form) {
            form.addEventListener("submit", function(e) {
                e.preventDefault();
                var id = document.getElementById("adminGoldPlanId").value;
                var plan = {
                    id: id || ("gold-plan-" + Date.now()),
                    name: document.getElementById("adminGoldPlanName").value.trim(),
                    dailyReturn: Number(document.getElementById("adminGoldDailyReturn").value),
                    minInvestment: Number(document.getElementById("adminGoldMinInvest").value),
                    maxInvestment: Number(document.getElementById("adminGoldMaxInvest").value),
                    durationDays: Number(document.getElementById("adminGoldDuration").value),
                    enabled: document.getElementById("adminGoldEnabled").checked,
                    paused: false
                };
                adminUpsertGoldPlan(plan).then(function(result) {
                    if (result && result.ok) {
                        adminNotify("Gold plan saved.");
                        closePlanForm();
                        refreshGoldAdmin();
                    } else {
                        adminNotify((result && result.error) || "Save failed.", true);
                    }
                });
            });
        }

        var searchBtn = document.getElementById("adminGoldSearchBtn");
        var searchInput = document.getElementById("adminGoldInvestorSearch");
        if (searchBtn) {
            searchBtn.addEventListener("click", function() {
                adminSearchGoldInvestors(searchInput ? searchInput.value : "").then(function(result) {
                    if (result && result.ok) {
                        renderInvestors(result.investors || []);
                        renderPayoutLog(result.payoutLog || []);
                    }
                });
            });
        }

        var creditsBtn = document.getElementById("adminGoldProcessCreditsBtn");
        if (creditsBtn) {
            creditsBtn.addEventListener("click", function() {
                adminProcessAllGoldCredits().then(function(result) {
                    if (result && result.ok) {
                        adminNotify("Processed daily credits for " + (result.credited || 0) + " investor(s).");
                        refreshGoldAdmin();
                    } else {
                        adminNotify((result && result.error) || "Credit run failed.", true);
                    }
                });
            });
        }

        refreshGoldAdmin();
    }

    document.addEventListener("DOMContentLoaded", function() {
        document.body.addEventListener("admin-auth-ready", initGoldAdmin);
        if (document.body.classList.contains("admin-auth-ready")) {
            initGoldAdmin();
        }
    });
})();
