(function() {
    "use strict";

    var initialized = false;

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatDate(iso) {
        if (!iso) return "—";
        try { return new Date(iso).toLocaleString(); } catch (e) { return esc(iso); }
    }

    function toast(message, isError) {
        if (typeof window.adminToast === "function") window.adminToast(message, isError);
        else if (isError) console.warn(message);
        else console.log(message);
    }

    function credentials() {
        return typeof getAdminApiCredentials === "function"
            ? getAdminApiCredentials()
            : { adminEmail: "", adminPassword: "" };
    }

    function apiGet(params) {
        var creds = credentials();
        if (!creds.adminPassword) {
            return Promise.resolve({
                ok: false,
                error: "Admin session needs password for server APIs. Log out and sign in again at admin.html."
            });
        }
        if (typeof isServerSyncAvailable === "function" && !isServerSyncAvailable()) {
            return Promise.resolve({ ok: false, error: "Requires server connection." });
        }
        var query = [
            "adminEmail=" + encodeURIComponent(creds.adminEmail),
            "adminPassword=" + encodeURIComponent(creds.adminPassword)
        ];
        Object.keys(params || {}).forEach(function(key) {
            if (params[key] != null && params[key] !== "") {
                query.push(key + "=" + encodeURIComponent(params[key]));
            }
        });
        return registryFetch("/api/investment-emails?" + query.join("&"), { cache: "no-store" })
            .then(function(response) { return response.json(); })
            .catch(function(err) { return { ok: false, error: String(err && err.message || err) }; });
    }

    function apiPost(body) {
        var creds = credentials();
        if (!creds.adminPassword) {
            return Promise.resolve({ ok: false, error: "Admin session needs password for server APIs." });
        }
        return registryFetch("/api/investment-emails", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.assign({}, creds, body))
        })
            .then(function(response) { return response.json(); })
            .catch(function(err) { return { ok: false, error: String(err && err.message || err) }; });
    }

    function renderStats(counts) {
        var el = document.getElementById("adminInvEmailStats");
        if (!el) return;
        var order = ["queued", "sent", "delivered", "deferred", "failed", "bounced"];
        var labels = {
            queued: "Queued", sent: "Sent", delivered: "Delivered",
            deferred: "Deferred", failed: "Failed", bounced: "Bounced"
        };
        el.innerHTML = order.map(function(key) {
            var value = (counts && counts[key]) || 0;
            if (key === "queued") value += (counts && counts.sending) || 0;
            return "<article class=\"card admin-stat-card\"><div><p class=\"admin-stat-label\">" + labels[key] +
                "</p><div class=\"balance admin-stat-value\">" + value + "</div></div></article>";
        }).join("");
    }

    function renderConfig(config) {
        var el = document.getElementById("adminInvEmailConfig");
        if (!el || !config) return;
        var notes = ["Sender: " + config.sender];
        if (config.senderWarning) notes.push(config.senderWarning);
        if (!config.resendConfigured) notes.push("RESEND_API_KEY is not configured.");
        if (!config.webhookSecretConfigured) {
            notes.push("RESEND_WEBHOOK_SECRET is not configured: delivery, bounce and complaint events cannot be recorded.");
        }
        if (!config.adminAlertRecipientsConfigured) {
            notes.push("INVESTMENT_EMAIL_ADMIN_ALERT_TO is not set: no alert email is sent when retries are exhausted.");
        }
        el.textContent = notes.join(" · ");
    }

    function render(notifications) {
        var body = document.getElementById("adminInvEmailBody");
        if (!body) return;
        if (!notifications || !notifications.length) {
            body.innerHTML = "<tr><td colspan=\"10\">No investment emails found.</td></tr>";
            return;
        }
        body.innerHTML = notifications.map(function(n) {
            var reason = n.failureReason
                ? "<div class=\"admin-email-reason\">" + esc(n.failureReason) +
                    (n.status === "queued" && n.nextAttemptAt ? "<br>Next retry: " + esc(formatDate(n.nextAttemptAt)) : "") +
                    "</div>"
                : "—";
            var action = n.canRetry
                ? "<button type=\"button\" class=\"deposit-btn admin-inv-email-retry\" data-id=\"" + esc(n.id) + "\">Retry</button>"
                : "—";
            return "<tr>" +
                "<td>" + esc(n.customerName) + "</td>" +
                "<td>" + esc(n.customerEmail) + "</td>" +
                "<td>" + esc(n.asset) + "</td>" +
                "<td>" + esc(n.reference) + (n.simulated ? "<br><small>Simulated</small>" : "") + "</td>" +
                "<td>" + esc(n.emailType) + "</td>" +
                "<td><span class=\"admin-email-status " + esc(n.status) + "\">" + esc(n.statusLabel) +
                    (n.attempts > 1 ? " <small>(" + n.attempts + " attempts)</small>" : "") + "</span></td>" +
                "<td>" + esc(formatDate(n.sentAt)) + "</td>" +
                "<td>" + esc(formatDate(n.deliveredAt)) + "</td>" +
                "<td>" + reason + "</td>" +
                "<td>" + action + "</td>" +
                "</tr>";
        }).join("");

        body.querySelectorAll(".admin-inv-email-retry").forEach(function(btn) {
            btn.addEventListener("click", function() {
                btn.disabled = true;
                apiPost({ action: "retry", id: btn.getAttribute("data-id") }).then(function(result) {
                    if (result && result.ok) {
                        toast("Retry queued. Status: " + (result.notification && result.notification.statusLabel || "Queued"));
                    } else {
                        toast((result && result.error) || "Retry failed.", true);
                    }
                    load();
                });
            });
        });
    }

    function load() {
        var search = document.getElementById("adminInvEmailSearch");
        var status = document.getElementById("adminInvEmailStatus");
        return apiGet({
            action: "list",
            q: search ? search.value.trim() : "",
            status: status ? status.value : ""
        }).then(function(result) {
            var body = document.getElementById("adminInvEmailBody");
            if (!result || !result.ok) {
                if (body) {
                    body.innerHTML = "<tr><td colspan=\"10\">" + esc((result && result.error) || "Could not load email notifications.") + "</td></tr>";
                }
                return;
            }
            renderStats(result.counts);
            renderConfig(result.config);
            render(result.notifications);
        });
    }

    function init() {
        if (initialized || !document.getElementById("section-investment-emails")) return;
        initialized = true;

        var refresh = document.getElementById("adminInvEmailRefresh");
        if (refresh) refresh.addEventListener("click", load);

        var status = document.getElementById("adminInvEmailStatus");
        if (status) status.addEventListener("change", load);

        var search = document.getElementById("adminInvEmailSearch");
        if (search) {
            search.addEventListener("keydown", function(e) {
                if (e.key === "Enter") load();
            });
        }

        var processBtn = document.getElementById("adminInvEmailProcess");
        if (processBtn) {
            processBtn.addEventListener("click", function() {
                processBtn.disabled = true;
                apiPost({ action: "process" }).then(function(result) {
                    processBtn.disabled = false;
                    if (result && result.ok) {
                        toast("Queue processed: " + result.sent + " sent, " + result.requeued + " re-queued, " + result.failed + " failed.");
                    } else {
                        toast((result && result.error) || "Queue run failed.", true);
                    }
                    load();
                });
            });
        }

        load();
        setInterval(load, 30000);
    }

    document.addEventListener("DOMContentLoaded", function() {
        document.body.addEventListener("admin-auth-ready", init);
        if (document.body.classList.contains("admin-auth-ready")) init();
    });
})();
