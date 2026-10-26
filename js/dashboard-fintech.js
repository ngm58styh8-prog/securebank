(function() {
    "use strict";

    var BALANCE_HIDE_KEY = "securebank_hide_balances";
    var HISTORY_PREFIX = "globalvest_balance_history_";
    var HISTORY_MAX_DAYS = 90;
    var PRICE_WAIT_MS = 8000;
    var startedAt = Date.now();
    var ctxRef = null;
    var txRows = [];

    /* ---------- helpers ---------- */

    function balancesHidden() {
        try { return localStorage.getItem(BALANCE_HIDE_KEY) === "1"; } catch (e) { return false; }
    }

    function maskText(formatted) {
        return balancesHidden() ? "••••••••" : formatted;
    }

    function escapeHtml(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function byId(id) { return document.getElementById(id); }

    function setText(id, text) {
        var el = byId(id);
        if (el) el.textContent = text;
    }

    function setMasked(id, formatted) {
        var el = byId(id);
        if (!el) return;
        el.setAttribute("data-balance-mask", "1");
        el.setAttribute("data-balance-value", formatted);
        el.textContent = maskText(formatted);
    }

    function setChange(id, pct, label) {
        var el = byId(id);
        if (!el) return;
        if (pct == null || isNaN(pct)) {
            el.textContent = "Today's change unavailable";
            el.className = "gv-ft-acct-change neutral";
            return;
        }
        el.textContent = (label || "Today's change") + ": " + (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
        el.className = "gv-ft-acct-change " + (pct >= 0 ? "up" : "down");
    }

    /* ---------- privacy toggle ---------- */

    function updatePrivacyIcon(hidden) {
        var btn = byId("balancePrivacyToggle");
        if (!btn) return;
        btn.setAttribute("aria-pressed", hidden ? "true" : "false");
        btn.setAttribute("aria-label", hidden ? "Show balances" : "Hide balances");
        btn.innerHTML = hidden
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    function applyGainMask() {
        var gain = byId("heroTodayGain");
        if (!gain) return;
        if (balancesHidden()) {
            gain.textContent = "Today's change hidden";
        } else if (gain.getAttribute("data-gain-value")) {
            gain.textContent = gain.getAttribute("data-gain-value");
        }
    }

    function applyBalanceMask() {
        document.querySelectorAll("[data-balance-mask]").forEach(function(el) {
            var val = el.getAttribute("data-balance-value");
            if (val != null) el.textContent = maskText(val);
        });
        applyGainMask();
    }

    function setBalancesHidden(hidden) {
        try { localStorage.setItem(BALANCE_HIDE_KEY, hidden ? "1" : "0"); } catch (e) { /* ignore */ }
        document.body.classList.toggle("balances-hidden", hidden);
        updatePrivacyIcon(hidden);
        if (ctxRef) window.updateFintechDashboard(ctxRef);
        else applyBalanceMask();
    }

    /* ---------- real balance history (daily snapshots observed on this device) ---------- */

    function todayKey() {
        var d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function loadHistory(user) {
        try {
            var raw = JSON.parse(localStorage.getItem(HISTORY_PREFIX + user));
            return Array.isArray(raw) ? raw : [];
        } catch (e) { return []; }
    }

    function saveHistory(user, hist) {
        try {
            localStorage.setItem(HISTORY_PREFIX + user, JSON.stringify(hist.slice(-HISTORY_MAX_DAYS)));
        } catch (e) { /* storage full / blocked */ }
    }

    function recordSnapshot(user, values) {
        var hist = loadHistory(user);
        var key = todayKey();
        var row = hist.length ? hist[hist.length - 1] : null;
        if (!row || row.d !== key) {
            row = { d: key, open: values, last: values };
            hist.push(row);
        } else {
            row.last = values;
        }
        saveHistory(user, hist);
        return hist;
    }

    function seriesFrom(hist, field) {
        var out = [];
        hist.forEach(function(r) {
            if (r.last && typeof r.last[field] === "number") out.push({ label: r.d, value: r.last[field] });
        });
        return out;
    }

    /* Bank balance activity reconstructed from the transaction ledger (newest first). */
    function ledgerCashSeries(account) {
        var tx = Array.isArray(account.transactions) ? account.transactions : [];
        var balance = Number(account.cash) || 0;
        var pts = [{ label: "Now", value: balance }];
        for (var i = 0; i < tx.length && pts.length < 31; i++) {
            var amt = Number(tx[i].amount) || 0;
            if (!amt) continue;
            balance -= amt;
            pts.unshift({ label: tx[i].date || "", value: balance });
        }
        return pts.length >= 2 ? pts : [];
    }

    /* ---------- drawing ---------- */

    function drawLine(canvas, points, color, withFill) {
        if (!canvas) return;
        var rect = canvas.getBoundingClientRect();
        var cssW = Math.max(rect.width, 40);
        var cssH = Math.max(rect.height, 24);
        var dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        var g = canvas.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, cssW, cssH);
        if (!points || points.length < 2) return;

        var vals = points.map(function(p) { return p.value; });
        var min = Math.min.apply(null, vals);
        var max = Math.max.apply(null, vals);
        var span = max - min;
        var pad = 4;
        function xy(i) {
            var x = pad + (i / (points.length - 1)) * (cssW - pad * 2);
            var y = span === 0 ? cssH / 2 : cssH - pad - ((vals[i] - min) / span) * (cssH - pad * 2);
            return [x, y];
        }

        g.beginPath();
        points.forEach(function(_, i) {
            var c = xy(i);
            if (i === 0) g.moveTo(c[0], c[1]); else g.lineTo(c[0], c[1]);
        });
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.lineJoin = "round";
        g.shadowColor = color;
        g.shadowBlur = 6;
        g.stroke();
        g.shadowBlur = 0;

        if (withFill) {
            var last = xy(points.length - 1);
            var first = xy(0);
            g.lineTo(last[0], cssH);
            g.lineTo(first[0], cssH);
            g.closePath();
            var grad = g.createLinearGradient(0, 0, 0, cssH);
            grad.addColorStop(0, color + "55");
            grad.addColorStop(1, color + "00");
            g.fillStyle = grad;
            g.fill();
        }
    }

    /* ---------- transactions ---------- */

    var TYPE_LABELS = {
        deposit: "Deposit", withdrawal: "Withdrawal", transfer: "Transfer",
        trade: "Trade", admin: "Account Adjustment", general: "Transaction"
    };
    var TYPE_ICONS = {
        deposit: "↓", withdrawal: "↑", transfer: "⇄", trade: "📈", admin: "🛡️", general: "💰"
    };

    function ledgerType(desc) {
        if (typeof classifyLedgerType === "function") return classifyLedgerType(desc);
        return "general";
    }

    function statusOf(desc) {
        var d = String(desc || "").toLowerCase();
        if (/reject|declin|fail/.test(d)) return "failed";
        if (/revers|refund/.test(d)) return "reversed";
        if (/pending|await/.test(d)) return "pending";
        if (/processing/.test(d)) return "processing";
        return "completed";
    }

    var STATUS_LABELS = {
        pending: "Pending", processing: "Processing", completed: "Completed",
        failed: "Failed", reversed: "Reversed"
    };

    function counterparty(desc) {
        var s = String(desc || "");
        var dash = s.split("—");
        if (dash.length > 1) return dash.slice(1).join("—").trim();
        var m = s.match(/(?:to|from)\s+(.+?)(?:\s+\(|$)/i);
        return m ? m[1].trim() : "";
    }

    function buildRows(ctx) {
        var rows = [];

        (ctx.pendingTransfers || []).forEach(function(t) {
            rows.push({
                type: "withdrawal", title: "Withdrawal Request", party: t.destination || "",
                amount: -Math.abs(Number(t.amount) || 0), status: "pending", date: t.date || "",
                note: "Awaiting admin approval. Funds are not debited until approved.", live: true
            });
        });
        (ctx.pendingDeposits || []).forEach(function(d) {
            var cur = (d.currency || "BTC").toUpperCase();
            var crypto = d.cryptoAmount || (cur === "BTC" ? d.btcAmount : cur === "ETH" ? d.ethAmount : null);
            var cryptoText = crypto && typeof formatDepositCryptoAmount === "function"
                ? "≈ " + formatDepositCryptoAmount(crypto, cur) + ". " : "";
            rows.push({
                type: "deposit", title: cur + " Deposit", party: d.payTo || "",
                amount: Math.abs(Number(d.amount) || 0), status: "pending", date: d.date || "",
                note: cryptoText + "Awaiting blockchain confirmation and admin approval. Not credited yet.", live: true
            });
        });

        (ctx.account.transactions || []).slice(0, 40).forEach(function(t) {
            var desc = t.description || "Transaction";
            /* Superseded by live pending lists / resolution entries. */
            if (/\(pending\)/i.test(desc)) return;
            var type = ledgerType(desc);
            var status = statusOf(desc);
            rows.push({
                type: type,
                title: desc.split("—")[0].replace(/\s*\([^)]*\)\s*$/, "").trim() || TYPE_LABELS[type],
                party: counterparty(desc),
                amount: Number(t.amount) || 0,
                status: status,
                date: t.date || "",
                note: desc,
                live: false
            });
        });
        return rows.slice(0, 6);
    }

    function formatRowAmount(ctx, row) {
        if (!row.amount) return "—";
        var sign = row.amount > 0 ? "+" : "-";
        return sign + formatMoney(Math.abs(row.amount), ctx.settings.currency);
    }

    function renderRecentTransactions(ctx) {
        var list = byId("recentTxList");
        if (!list) return;
        txRows = buildRows(ctx);

        if (!txRows.length) {
            list.innerHTML = '<div class="gv-ft-tx-empty">No transactions yet. Deposits, transfers and trades will appear here.</div>';
            return;
        }

        list.innerHTML = txRows.map(function(r, idx) {
            var dir = r.amount > 0 ? "in" : (r.amount < 0 ? "out" : "neutral");
            var cls = r.status === "pending" || r.status === "processing" ? "pending"
                : (r.status === "failed" || r.status === "reversed" ? "failed" : dir);
            var amt = balancesHidden() ? "••••••••" : formatRowAmount(ctx, r);
            return '<button type="button" class="gv-ft-tx-item" data-tx-index="' + idx + '">' +
                '<span class="gv-ft-tx-icon" aria-hidden="true">' + (TYPE_ICONS[r.type] || "💰") + '</span>' +
                '<span class="gv-ft-tx-body">' +
                '<span class="gv-ft-tx-title">' + escapeHtml(r.title) + '</span>' +
                '<span class="gv-ft-tx-sub">' + escapeHtml(r.party ? r.party + " · " : "") + escapeHtml(r.date) + '</span>' +
                '</span>' +
                '<span class="gv-ft-tx-right">' +
                '<span class="gv-ft-tx-amt ' + cls + '">' + escapeHtml(amt) + '</span>' +
                '<span class="gv-ft-status ' + r.status + '">' + STATUS_LABELS[r.status] + '</span>' +
                '</span></button>';
        }).join("");
    }

    function ensureTxModal() {
        var modal = byId("ftTxModal");
        if (modal) return modal;
        modal = document.createElement("div");
        modal.id = "ftTxModal";
        modal.className = "gv-ft-modal hidden";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "ftTxModalTitle");
        modal.innerHTML =
            '<div class="gv-ft-modal-card">' +
            '<button type="button" class="gv-ft-modal-close" id="ftTxModalClose" aria-label="Close">✕</button>' +
            '<h3 id="ftTxModalTitle">Transaction details</h3>' +
            '<dl class="gv-ft-detail" id="ftTxModalBody"></dl>' +
            '<a class="gv-ft-grow-btn" href="wallet.html#transactions">Open full history →</a>' +
            '</div>';
        document.body.appendChild(modal);
        modal.addEventListener("click", function(e) {
            if (e.target === modal || e.target.id === "ftTxModalClose") {
                e.preventDefault();
                e.stopPropagation();
                closeTxModal();
            }
        });
        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape") closeTxModal();
        });
        return modal;
    }

    var modalClosedAt = 0;

    function closeTxModal() {
        var modal = byId("ftTxModal");
        if (modal && !modal.classList.contains("hidden")) {
            modal.classList.add("hidden");
            modalClosedAt = Date.now();
        }
    }

    function openTxModal(idx) {
        var r = txRows[idx];
        var ctx = ctxRef;
        if (!r || !ctx) return;
        if (Date.now() - modalClosedAt < 400) return; /* ignore the tap-through after closing */
        var modal = ensureTxModal();
        var dirLabel = r.amount > 0 ? "Incoming" : (r.amount < 0 ? "Outgoing" : "No balance change");
        var amt = balancesHidden() ? "••••••••" : formatRowAmount(ctx, r);
        var rowsHtml = [
            ["Type", TYPE_LABELS[r.type] || "Transaction"],
            ["Description", r.title],
            ["Counterparty", r.party || "—"],
            ["Direction", dirLabel],
            ["Amount", amt],
            ["Currency", ctx.settings.currency || "USD"],
            ["Date", r.date || "—"],
            ["Status", '<span class="gv-ft-status ' + r.status + '">' + STATUS_LABELS[r.status] + "</span>"]
        ].map(function(pair) {
            var val = pair[0] === "Status" ? pair[1] : escapeHtml(pair[1]);
            return "<div><dt>" + pair[0] + "</dt><dd>" + val + "</dd></div>";
        }).join("");
        if (r.note && r.note !== r.title) {
            rowsHtml += "<div><dt>Ledger note</dt><dd>" + escapeHtml(r.note) + "</dd></div>";
        }
        byId("ftTxModalBody").innerHTML = rowsHtml;
        modal.classList.remove("hidden");
        byId("ftTxModalClose").focus();
    }

    /* ---------- main update ---------- */

    function weightedInvestChangePct(ctx) {
        var total = 0, weighted = 0;
        ctx.ALL_ASSETS.forEach(function(a) {
            var v = ctx.assetValue(a.key);
            if (v <= 0 || !(ctx.prices[a.key] > 0)) return;
            total += v;
            weighted += v * (ctx.changes[a.key] || 0);
        });
        return total ? weighted / total : null;
    }

    function dayChangePct(hist, field, current) {
        var row = hist.length ? hist[hist.length - 1] : null;
        if (!row || row.d !== todayKey() || !row.open) return null;
        var open = row.open[field];
        if (typeof open !== "number" || open <= 0) return null;
        return ((current - open) / open) * 100;
    }

    window.updateFintechDashboard = function(ctx) {
        ctxRef = ctx;
        var account = ctx.account;
        var currency = ctx.settings.currency || "USD";

        var bank = Number(account.cash) || 0;
        var invest = 0;
        var positions = 0;
        ctx.ALL_ASSETS.forEach(function(a) {
            var v = ctx.assetValue(a.key);
            invest += v;
            if ((account.holdings && account.holdings[a.key]) > 0) positions++;
        });
        var gi = account.goldInvestment || {};
        var savings = ctx.getGoldInvestmentBalance(account) || 0;
        var total = ctx.portfolioValue();
        var pricesWaiting = !ctx.pricesReady && (Date.now() - startedAt) < PRICE_WAIT_MS;
        var pricesMissing = !ctx.pricesReady && !pricesWaiting;

        setText("ftCurrency", currency);

        var hero = byId("heroPortfolioValue");
        var totalFormatted = ctx.formatPrice(total);
        if (hero) {
            hero.setAttribute("data-balance-mask", "1");
            if (pricesWaiting) {
                hero.removeAttribute("data-balance-value");
                hero.textContent = "Loading…";
            } else {
                hero.setAttribute("data-balance-value", totalFormatted);
                if (balancesHidden()) hero.textContent = "••••••••";
                else if (/^(Loading…|••••••••)?$/.test(hero.textContent) || /^\$0\.00$/.test(hero.textContent)) hero.textContent = totalFormatted;
            }
        }

        /* Bank */
        var available = bank - (ctx.pendingTotal || 0);
        setMasked("ftBankBalance", ctx.formatPrice(bank));
        setMasked("ftBankAvail", "Available " + ctx.formatPrice(Math.max(available, 0)));
        var bankStatus = byId("ftBankStatus");
        if (bankStatus) {
            var frozen = !!account.withdrawalsFrozen;
            bankStatus.textContent = frozen ? "Withdrawals frozen" : "Active";
            bankStatus.className = "gv-ft-chip " + (frozen ? "warn" : "ok");
        }

        /* Investment */
        var investEl = byId("ftInvestBalance");
        if (pricesWaiting) {
            if (investEl) {
                investEl.removeAttribute("data-balance-value");
                investEl.textContent = "Loading…";
            }
            setText("ftInvestSummary", "Fetching live prices…");
        } else if (pricesMissing) {
            if (investEl) {
                investEl.removeAttribute("data-balance-value");
                investEl.textContent = "Unavailable";
            }
            setText("ftInvestSummary", "Live market prices unavailable");
        } else {
            setMasked("ftInvestBalance", ctx.formatPrice(invest));
            setText("ftInvestSummary", positions
                ? positions + (positions === 1 ? " position" : " positions") + " held"
                : "No investments yet");
        }

        /* Savings (Gold Investment program) */
        setMasked("ftSavingsBalance", ctx.formatPrice(savings));
        setMasked("ftSavingsInterest", "Interest earned " + ctx.formatPrice(Number(gi.totalEarned) || 0));
        var saveStatus = byId("ftSavingsStatus");
        if (saveStatus) {
            saveStatus.textContent = gi.active ? (gi.planName || "Active") : "No active plan";
            saveStatus.className = "gv-ft-chip " + (gi.active ? "ok" : "muted");
        }

        /* History + daily change (only recorded once live prices are available) */
        var hist = loadHistory(ctx.username);
        if (ctx.pricesReady) {
            hist = recordSnapshot(ctx.username, { total: total, bank: bank, invest: invest, save: savings });
        }

        setChange("ftBankChange", dayChangePct(hist, "bank", bank));
        setChange("ftInvestChange", ctx.pricesReady ? weightedInvestChangePct(ctx) : null, "24h market change");
        var saveRet = gi.active && savings > 0 && Number(gi.todayReturn) > 0
            ? (Number(gi.todayReturn) / savings) * 100 : null;
        setChange("ftSavingsChange", saveRet, "Today's return");

        var totalSeries = seriesFrom(hist, "total");
        var noteText;
        var heroSeries;
        if (totalSeries.length >= 2) {
            heroSeries = totalSeries;
            noteText = "Total balance — daily closes recorded on this device (" + totalSeries.length + " days)";
        } else {
            heroSeries = ledgerCashSeries(account);
            noteText = heroSeries.length
                ? "Bank balance activity from your transaction ledger. Total-balance history builds daily."
                : "Not enough history yet — the chart fills in as your balance changes.";
        }
        if (pricesMissing) {
            noteText = "Live market prices unavailable — total excludes investment valuation until prices load.";
        }
        drawLine(byId("heroSparkChart"), heroSeries, "#00E89B", true);
        setText("ftChartNote", noteText);

        drawLine(byId("ftSparkBank"), seriesFrom(hist, "bank").length >= 2 ? seriesFrom(hist, "bank") : ledgerCashSeries(account), "#00E89B", false);
        drawLine(byId("ftSparkInvest"), seriesFrom(hist, "invest"), "#00C8FF", false);
        drawLine(byId("ftSparkSave"), seriesFrom(hist, "save"), "#FFBE45", false);

        if (typeof ctx.setPortfolioSeries === "function") {
            ctx.setPortfolioSeries(
                totalSeries.map(function(p) { return p.label; }),
                totalSeries.map(function(p) { return p.value; })
            );
        }

        renderRecentTransactions(ctx);
        applyBalanceMask();
    };

    /* ---------- controls ---------- */

    function initPrivacyToggle() {
        document.body.classList.toggle("balances-hidden", balancesHidden());
        updatePrivacyIcon(balancesHidden());
        var btn = byId("balancePrivacyToggle");
        if (btn) btn.addEventListener("click", function() { setBalancesHidden(!balancesHidden()); });
    }

    function initMoreMenu() {
        var trigger = byId("moreQuickBtn");
        var menu = byId("ftMoreMenu");
        if (!trigger || !menu) return;
        function setOpen(open) {
            menu.classList.toggle("hidden", !open);
            trigger.setAttribute("aria-expanded", open ? "true" : "false");
        }
        trigger.addEventListener("click", function(e) {
            e.stopPropagation();
            setOpen(menu.classList.contains("hidden"));
        });
        menu.addEventListener("click", function(e) { e.stopPropagation(); });
        document.addEventListener("click", function() { setOpen(false); });
        document.addEventListener("keydown", function(e) { if (e.key === "Escape") setOpen(false); });
        menu.querySelectorAll("[data-ft-more-href]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                window.location.href = btn.getAttribute("data-ft-more-href");
            });
        });
    }

    function initSidebar() {
        var sidebar = byId("gvSidebar");
        var toggle = byId("sidebarToggle");
        if (!sidebar) return;
        var scrim = document.createElement("div");
        scrim.className = "gv-ft-scrim";
        scrim.hidden = true;
        document.body.appendChild(scrim);

        function sync() {
            var open = sidebar.classList.contains("open");
            scrim.hidden = !open;
            if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
        }
        function close() { sidebar.classList.remove("open"); sync(); }

        if (toggle) {
            toggle.setAttribute("aria-controls", "gvSidebar");
            toggle.addEventListener("click", function() { window.setTimeout(sync, 0); });
        }
        scrim.addEventListener("click", close);
        document.addEventListener("keydown", function(e) { if (e.key === "Escape") close(); });
        sidebar.addEventListener("click", function(e) {
            if (e.target.closest("a")) close();
        });
    }

    function initNotifDismiss() {
        function closePanel() {
            var panel = byId("notifPanel");
            var btn = byId("notifBtn");
            if (panel && !panel.classList.contains("hidden")) {
                panel.classList.add("hidden");
                if (btn) btn.setAttribute("aria-expanded", "false");
            }
        }
        document.addEventListener("click", function(e) {
            if (e.target.closest("#notifPanel") || e.target.closest("#notifBtn")) return;
            closePanel();
        });
        document.addEventListener("keydown", function(e) { if (e.key === "Escape") closePanel(); });
    }

    function initSidebarLogout() {
        var btn = byId("gvSidebarLogout");
        if (!btn) return;
        btn.addEventListener("click", function(e) {
            e.preventDefault();
            if (typeof logout === "function") logout();
            else window.location.href = "login.html";
        });
    }

    function initTxList() {
        var list = byId("recentTxList");
        if (!list) return;
        list.addEventListener("click", function(e) {
            var item = e.target.closest("[data-tx-index]");
            if (item) openTxModal(Number(item.getAttribute("data-tx-index")));
        });
    }

    function wrapHeroAnimation() {
        if (window.__gvHeroWrapped) return;
        var prev = window.animateHeroPortfolio;
        if (typeof prev !== "function") return;
        window.__gvHeroWrapped = true;
        window.animateHeroPortfolio = function(amount, formatted) {
            var el = byId("heroPortfolioValue");
            if (el && typeof formatted === "string") {
                el.setAttribute("data-balance-value", formatted);
                if (balancesHidden()) {
                    el.textContent = "••••••••";
                    return;
                }
            }
            prev(amount, formatted);
        };
    }

    var resizeTimer = null;
    window.addEventListener("resize", function() {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function() {
            if (ctxRef) window.updateFintechDashboard(ctxRef);
        }, 200);
    });

    /* Re-evaluate the "prices unavailable" state once the wait window passes. */
    window.setTimeout(function() {
        if (ctxRef && !ctxRef.pricesReady) window.updateFintechDashboard(ctxRef);
    }, PRICE_WAIT_MS + 200);

    document.addEventListener("DOMContentLoaded", function() {
        initPrivacyToggle();
        initMoreMenu();
        initSidebar();
        initSidebarLogout();
        initNotifDismiss();
        initTxList();
        ensureTxModal();
        wrapHeroAnimation();
        window.setTimeout(wrapHeroAnimation, 250);
    });
})();
