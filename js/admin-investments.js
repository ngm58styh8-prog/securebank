(function() {
    "use strict";

    function formatUsd(amount) {
        var n = Number(amount);
        if (isNaN(n)) n = 0;
        return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(iso) {
        if (!iso) return "—";
        try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    }

    function toast(msg, err) {
        if (typeof window.adminToast === "function") window.adminToast(msg, err);
        else if (err) console.warn(msg);
        else console.log(msg);
    }

    function creds() {
        if (typeof getAdminApiCredentials === "function") return getAdminApiCredentials();
        var admin = typeof getAdminData === "function" ? getAdminData() : {};
        return { adminEmail: admin.email || "", adminPassword: "" };
    }

    function simFetch(action, options) {
        options = options || {};
        if (typeof adminSimulationFetch === "function") {
            return adminSimulationFetch(action, options);
        }
        return Promise.resolve({ ok: false, error: "Simulation API unavailable." });
    }

    function setTab(panelId) {
        document.querySelectorAll(".admin-inv-tab").forEach(function(btn) {
            btn.classList.toggle("active", btn.dataset.invPanel === panelId);
        });
        document.querySelectorAll(".admin-inv-panel").forEach(function(panel) {
            panel.classList.toggle("active", panel.id === panelId);
        });
    }

    function renderOverview(data) {
        var el = document.getElementById("adminInvOverviewStats");
        if (!el || !data || !data.overview) return;
        var o = data.overview;
        el.innerHTML =
            statCard("Active simulations", o.totalActiveSimulations) +
            statCard("Simulated invested", formatUsd(o.totalSimulatedInvestmentUsd)) +
            statCard("Simulated earnings", formatUsd(o.totalSimulatedEarningsUsd)) +
            statCard("Credits today", o.calculationsCompletedToday) +
            statCard("Upcoming calcs", o.upcomingCalculations) +
            statCard("Failed jobs", o.failedCalculationJobs);
    }

    function statCard(label, value) {
        return "<article class=\"card admin-stat-card\"><div><p class=\"admin-stat-label\">" +
            label + "</p><div class=\"balance admin-stat-value\">" + value + "</div></div></article>";
    }

    function rowCells(cells) {
        return "<tr>" + cells.map(function(c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
    }

    function renderInvestmentTable(bodyId, rows, columns) {
        var body = document.getElementById(bodyId);
        if (!body) return;
        if (!rows || !rows.length) {
            body.innerHTML = "<tr><td colspan=\"8\">No investments found.</td></tr>";
            return;
        }
        body.innerHTML = rows.map(function(r) {
            if (columns === "gold") {
                return rowCells([
                    (r.userName || r.userEmail) + "<br><small>" + r.userEmail + "</small>",
                    r.planName || "—",
                    formatUsd(r.investedAmount),
                    formatUsd(r.totalSimulatedEarned),
                    formatUsd(r.dailySimulatedReturn),
                    r.status || "—"
                ]);
            }
            if (columns === "asset") {
                return rowCells([
                    (r.userName || r.userEmail) + "<br><small>" + r.userEmail + "</small>",
                    r.assetName || r.assetId,
                    r.planName || "—",
                    formatUsd(r.investedAmount),
                    formatUsd(r.totalSimulatedEarned),
                    r.status || "—"
                ]);
            }
            return rowCells([
                (r.userName || r.userEmail) + "<br><small>" + r.userEmail + "</small>",
                r.source || "—",
                r.assetName || r.assetId,
                r.planName || "—",
                formatUsd(r.investedAmount),
                formatUsd(r.totalSimulatedEarned),
                formatUsd(r.dailySimulatedReturn),
                r.status || "—"
            ]);
        }).join("");
    }

    function filterCategory(rows, cat) {
        return (rows || []).filter(function(r) { return r.category === cat; });
    }

    function renderPlans(plans, assets) {
        var container = document.getElementById("adminInvPlansList");
        var assetSelect = document.getElementById("adminInvPlanAsset");
        var filter = document.getElementById("adminInvAssetFilter");
        if (assetSelect && assets) {
            assetSelect.innerHTML = assets.map(function(a) {
                return "<option value=\"" + a.id + "\">" + a.name + " (" + a.symbol + ")</option>";
            }).join("");
        }
        if (filter && assets) {
            var cur = filter.value || "all";
            filter.innerHTML = "<option value=\"all\">All assets</option>" + assets.map(function(a) {
                return "<option value=\"" + a.id + "\">" + a.name + "</option>";
            }).join("") + "<option value=\"gold\">Gold (legacy)</option>";
            filter.value = cur;
        }
        if (!container) return;
        if (!plans || !plans.length) {
            container.innerHTML = "<p>No simulation plans.</p>";
            return;
        }
        container.innerHTML = plans.map(function(plan) {
            var ret = plan.returnType === "fixed"
                ? formatUsd(plan.dailyReturnFixed) + "/day fixed"
                : plan.dailyReturnPercent + "%/day";
            return "<article class=\"admin-gold-plan-card\" data-plan-id=\"" + plan.id + "\">" +
                "<h4>" + plan.name + " · " + plan.assetId.toUpperCase() + "</h4>" +
                "<div class=\"admin-gold-plan-meta\">" + ret + " · Min " + formatUsd(plan.minInvestment) +
                " · Max " + formatUsd(plan.maxInvestment) + " · " +
                (plan.enabled === false ? "Disabled" : plan.paused ? "Paused" : "Active") + "</div>" +
                "<div class=\"admin-gold-plan-actions\">" +
                "<button type=\"button\" class=\"deposit-btn admin-inv-edit-plan\" data-id=\"" + plan.id + "\">Edit</button>" +
                "</div></article>";
        }).join("");
        container.querySelectorAll(".admin-inv-edit-plan").forEach(function(btn) {
            btn.addEventListener("click", function() {
                var plan = plans.find(function(p) { return String(p.id) === btn.dataset.id; });
                openPlanForm(plan, assets);
            });
        });
    }

    function openPlanForm(plan, assets) {
        var card = document.getElementById("adminInvPlanFormCard");
        if (!card) return;
        card.style.display = "block";
        document.getElementById("adminInvPlanFormTitle").textContent = plan ? "Edit Simulation Plan" : "Create Simulation Plan";
        document.getElementById("adminInvPlanId").value = plan ? plan.id : "";
        if (assets && assets.length) {
            document.getElementById("adminInvPlanAsset").value = plan ? plan.assetId : assets[0].id;
        }
        document.getElementById("adminInvPlanName").value = plan ? plan.name : "";
        document.getElementById("adminInvReturnType").value = plan && plan.returnType === "fixed" ? "fixed" : "percent";
        document.getElementById("adminInvDailyPercent").value = plan ? plan.dailyReturnPercent : 1;
        document.getElementById("adminInvDailyFixed").value = plan ? plan.dailyReturnFixed : 0;
        document.getElementById("adminInvMin").value = plan ? plan.minInvestment : 100;
        document.getElementById("adminInvMax").value = plan ? plan.maxInvestment : 500000;
        document.getElementById("adminInvDuration").value = plan ? plan.durationDays : 365;
        document.getElementById("adminInvPlanEnabled").checked = plan ? plan.enabled !== false : true;
        document.getElementById("adminInvPlanPaused").checked = plan ? !!plan.paused : false;
    }

    function renderHistory(history) {
        var earn = document.getElementById("adminInvEarningsBody");
        var hist = document.getElementById("adminInvHistoryBody");
        if (!history || !history.length) {
            if (earn) earn.innerHTML = "<tr><td colspan=\"7\">No earnings yet.</td></tr>";
            if (hist) hist.innerHTML = "<tr><td colspan=\"6\">No history yet.</td></tr>";
            return;
        }
        if (earn) {
            earn.innerHTML = history.map(function(row) {
                return rowCells([
                    formatDate(row.createdAt || row.date),
                    row.source || "—",
                    row.userEmail || "—",
                    row.assetId || row.planId || "—",
                    formatUsd(row.amount),
                    row.status || "—",
                    row.notificationStatus || "—"
                ]);
            }).join("");
        }
        if (hist) {
            hist.innerHTML = history.map(function(row) {
                return rowCells([
                    formatDate(row.createdAt || row.date),
                    row.source || "—",
                    row.reference || "—",
                    row.userEmail || "—",
                    row.assetId || row.planId || "—",
                    formatUsd(row.amount)
                ]);
            }).join("");
        }
    }

    function renderMonitor(data) {
        var stats = document.getElementById("adminInvMonitorStats");
        if (stats && data.overview) renderOverview({ overview: data.overview });
        var jobs = document.getElementById("adminInvJobsBody");
        if (!jobs) return;
        var list = data.recentJobs || [];
        if (!list.length) {
            jobs.innerHTML = "<tr><td colspan=\"5\">No jobs recorded yet.</td></tr>";
            return;
        }
        jobs.innerHTML = list.map(function(j) {
            return rowCells([
                formatDate(j.startedAt),
                j.status,
                String(j.marketCredits != null ? j.marketCredits : "—"),
                String(j.goldCredits != null ? j.goldCredits : "—"),
                (j.errors && j.errors.length) ? j.errors.length + " error(s)" : "—"
            ]);
        }).join("");
    }

    function fillSettings(settings) {
        if (!settings) return;
        document.getElementById("adminInvEnrollmentsPaused").checked = !!settings.enrollmentsPaused;
        document.getElementById("adminInvCreditHours").value = settings.creditIntervalHours || 24;
        document.getElementById("adminInvNotifyOnCredit").checked = settings.notifyOnCredit !== false;
        document.getElementById("adminInvEducationalLabel").value = settings.educationalLabel || "";
    }

    function refreshAll() {
        var q = document.getElementById("adminInvSearch");
        var asset = document.getElementById("adminInvAssetFilter");
        var query = q ? q.value : "";
        var assetVal = asset ? asset.value : "all";

        return Promise.all([
            simFetch("overview"),
            simFetch("investments", { q: query, asset: assetVal }),
            simFetch("plans"),
            simFetch("history", { limit: 100 }),
            simFetch("monitoring")
        ]).then(function(results) {
            var overview = results[0];
            var list = results[1];
            var plans = results[2];
            var history = results[3];
            var monitor = results[4];

            if (overview.ok) renderOverview(overview);
            if (list.ok) {
                var rows = list.investments || [];
                renderInvestmentTable("adminInvAllBody", rows, "all");
                renderInvestmentTable("adminInvGoldBody", rows.filter(function(r) {
                    return r.source === "gold-legacy";
                }), "gold");
                renderInvestmentTable("adminInvCryptoBody", filterCategory(rows, "crypto"), "asset");
                renderInvestmentTable("adminInvStockBody", filterCategory(rows, "stock"), "asset");
                renderInvestmentTable("adminInvCommodityBody", rows.filter(function(r) {
                    return r.category === "commodity" && r.source !== "gold-legacy";
                }), "asset");
            }
            if (plans.ok) {
                renderPlans(plans.plans, plans.assets);
                fillSettings(plans.settings);
            }
            if (history.ok) renderHistory(history.history);
            if (monitor.ok) renderMonitor(monitor);
        });
    }

    function initInvestmentAdmin() {
        if (!document.getElementById("section-investment-management")) return;

        document.querySelectorAll(".admin-inv-tab").forEach(function(btn) {
            btn.addEventListener("click", function() { setTab(btn.dataset.invPanel); });
        });

        var refreshBtn = document.getElementById("adminInvRefreshBtn");
        if (refreshBtn) refreshBtn.addEventListener("click", function() {
            refreshAll().then(function() { toast("Investment data refreshed."); });
        });

        var searchBtn = document.getElementById("adminInvSearchBtn");
        if (searchBtn) searchBtn.addEventListener("click", function() { refreshAll(); });

        var runBtn = document.getElementById("adminInvRunCreditsBtn");
        if (runBtn) runBtn.addEventListener("click", function() {
            simFetch("process-all-credits", { method: "POST" }).then(function(r) {
                if (r.ok) toast("Credit run finished. Market: " + (r.marketCredits || 0) + ", Gold batch included.");
                else toast(r.error || "Credit run failed.", true);
                refreshAll();
            });
        });

        var retryBtn = document.getElementById("adminInvRetryCreditsBtn");
        if (retryBtn) retryBtn.addEventListener("click", function() {
            runBtn && runBtn.click();
        });

        var exportBtn = document.getElementById("adminInvExportBtn");
        if (exportBtn) exportBtn.addEventListener("click", function() {
            simFetch("export").then(function(r) {
                if (!r.ok || !r.csv) {
                    toast(r.error || "Export failed.", true);
                    return;
                }
                var blob = new Blob([r.csv], { type: "text/csv" });
                var a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "globalvest-investments-export.csv";
                a.click();
            });
        });

        var jumpGold = document.getElementById("adminInvJumpGoldBtn");
        if (jumpGold) jumpGold.addEventListener("click", function() {
            var el = document.getElementById("section-gold");
            if (el) el.scrollIntoView({ behavior: "smooth" });
        });

        var newPlan = document.getElementById("adminInvNewPlanBtn");
        if (newPlan) newPlan.addEventListener("click", function() {
            simFetch("plans").then(function(r) {
                openPlanForm(null, r.assets || []);
            });
        });

        var cancelPlan = document.getElementById("adminInvPlanCancelBtn");
        if (cancelPlan) cancelPlan.addEventListener("click", function() {
            document.getElementById("adminInvPlanFormCard").style.display = "none";
        });

        var planForm = document.getElementById("adminInvPlanForm");
        if (planForm) {
            planForm.addEventListener("submit", function(e) {
                e.preventDefault();
                var plan = {
                    id: document.getElementById("adminInvPlanId").value || undefined,
                    assetId: document.getElementById("adminInvPlanAsset").value,
                    name: document.getElementById("adminInvPlanName").value.trim(),
                    returnType: document.getElementById("adminInvReturnType").value,
                    dailyReturnPercent: Number(document.getElementById("adminInvDailyPercent").value),
                    dailyReturnFixed: Number(document.getElementById("adminInvDailyFixed").value),
                    minInvestment: Number(document.getElementById("adminInvMin").value),
                    maxInvestment: Number(document.getElementById("adminInvMax").value),
                    durationDays: Number(document.getElementById("adminInvDuration").value),
                    enabled: document.getElementById("adminInvPlanEnabled").checked,
                    paused: document.getElementById("adminInvPlanPaused").checked
                };
                simFetch("upsert-plan", { method: "POST", plan: plan }).then(function(r) {
                    if (r.ok) {
                        toast("Simulation plan saved.");
                        document.getElementById("adminInvPlanFormCard").style.display = "none";
                        refreshAll();
                    } else toast(r.error || "Save failed.", true);
                });
            });
        }

        var settingsForm = document.getElementById("adminInvSettingsForm");
        if (settingsForm) {
            settingsForm.addEventListener("submit", function(e) {
                e.preventDefault();
                var settings = {
                    enrollmentsPaused: document.getElementById("adminInvEnrollmentsPaused").checked,
                    creditIntervalHours: Number(document.getElementById("adminInvCreditHours").value),
                    notifyOnCredit: document.getElementById("adminInvNotifyOnCredit").checked,
                    educationalLabel: document.getElementById("adminInvEducationalLabel").value.trim()
                };
                simFetch("save-settings", { method: "POST", settings: settings }).then(function(r) {
                    if (r.ok) toast("Investment settings saved.");
                    else toast(r.error || "Settings save failed.", true);
                });
            });
        }

        refreshAll().catch(function(err) {
            toast(err.message || "Could not load investment management.", true);
        });
    }

    document.addEventListener("DOMContentLoaded", function() {
        document.body.addEventListener("admin-auth-ready", initInvestmentAdmin);
        if (document.body.classList.contains("admin-auth-ready")) initInvestmentAdmin();
    });
})();
