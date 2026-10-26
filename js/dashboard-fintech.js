(function() {
    var BALANCE_HIDE_KEY = "securebank_hide_balances";
    var ctxRef = null;
    var sparkCharts = { bank: null, invest: null, save: null };

    function balancesHidden() {
        try {
            return localStorage.getItem(BALANCE_HIDE_KEY) === "1";
        } catch (e) {
            return false;
        }
    }

    function setBalancesHidden(hidden) {
        try {
            localStorage.setItem(BALANCE_HIDE_KEY, hidden ? "1" : "0");
        } catch (e) { /* ignore */ }
        document.body.classList.toggle("balances-hidden", hidden);
        updatePrivacyIcon(hidden);
        if (ctxRef) {
            window.updateFintechDashboard(ctxRef);
            var gain = document.getElementById("heroTodayGain");
            if (gain) {
                if (hidden) {
                    gain.textContent = "Today's change hidden";
                } else {
                    gain.textContent = gain.getAttribute("data-gain-value") || gain.textContent;
                }
            }
        }
    }

    function updatePrivacyIcon(hidden) {
        var btn = document.getElementById("balancePrivacyToggle");
        if (!btn) return;
        btn.setAttribute("aria-pressed", hidden ? "true" : "false");
        btn.innerHTML = hidden
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    function maskText(formatted) {
        return balancesHidden() ? "••••••••" : formatted;
    }

    function setMaskedEl(el, formatted) {
        if (!el) return;
        el.setAttribute("data-balance-mask", "1");
        el.setAttribute("data-balance-value", formatted);
        el.textContent = maskText(formatted);
    }

    function applyBalanceMask(ctx) {
        document.querySelectorAll("[data-balance-mask]").forEach(function(el) {
            var val = el.getAttribute("data-balance-value") || "";
            el.textContent = maskText(val);
        });
        if (ctx && ctx.formatPrice) {
            var hero = document.getElementById("heroPortfolioValue");
            if (hero && hero.getAttribute("data-balance-value")) {
                hero.textContent = maskText(hero.getAttribute("data-balance-value"));
            }
        }
    }

    function weightedInvestChangePct(ctx) {
        var total = 0;
        var weighted = 0;
        ctx.ALL_ASSETS.forEach(function(a) {
            var v = ctx.assetValue(a.key);
            if (v <= 0) return;
            total += v;
            weighted += v * (ctx.changes[a.key] || 0);
        });
        if (!total) return null;
        return weighted / total;
    }

    function formatChangePct(pct) {
        if (pct == null || isNaN(pct)) return { text: "Today's change unavailable", cls: "neutral" };
        var sign = pct >= 0 ? "+" : "";
        return {
            text: "Today's Change: " + sign + pct.toFixed(2) + "%",
            cls: pct >= 0 ? "up" : "down"
        };
    }

    function drawSpark(canvasId, color, points) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        var w = canvas.width = canvas.offsetWidth * 2 || 144;
        var h = canvas.height = 64;
        var ctx = canvas.getContext("2d");
        if (!points || points.length < 2) {
            points = [0.4, 0.45, 0.42, 0.5, 0.48, 0.55, 0.52, 0.58];
        }
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach(function(p, i) {
            var x = (i / (points.length - 1)) * (w - 8) + 4;
            var y = h - 8 - p * (h - 16);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    function txIcon(desc) {
        var d = (desc || "").toLowerCase();
        if (/crypto|btc|eth|deposit/.test(d)) return "₿";
        if (/transfer|wire|send/.test(d)) return "⇄";
        if (/withdraw/.test(d)) return "↑";
        if (/card|payment|purchase/.test(d)) return "💳";
        if (/gold|savings/.test(d)) return "🐷";
        if (/buy|sell|invest/.test(d)) return "📈";
        return "💰";
    }

    function txStatus(desc, amount) {
        if (/pending|await|approval/i.test(desc || "")) return "pending";
        if (amount > 0) return "in";
        if (amount < 0) return "out";
        return "neutral";
    }

    function renderRecentTransactions(ctx) {
        var list = document.getElementById("recentTxList");
        if (!list || !ctx.account.transactions) return;

        var recent = ctx.account.transactions.slice(0, 6);
        if (!recent.length) {
            list.innerHTML = '<div class="gv-ft-tx-empty">No transactions yet. Deposits and transfers will appear here.</div>';
            return;
        }

        list.innerHTML = recent.map(function(t, idx) {
            var amount = Number(t.amount) || 0;
            var status = txStatus(t.description, amount);
            var sign = amount >= 0 ? "+" : "-";
            var amtFormatted = sign + formatMoney(Math.abs(amount), ctx.settings.currency);
            var amtDisplay = balancesHidden() ? "••••••••" : amtFormatted;
            var cls = status === "pending" ? "pending" : (amount >= 0 ? "in" : "out");
            var title = (t.description || "Transaction").split("—")[0].trim();
            return (
                '<a class="gv-ft-tx-item" href="wallet.html" data-tx-index="' + idx + '">' +
                '<div class="gv-ft-tx-icon">' + txIcon(t.description) + "</div>" +
                '<div class="gv-ft-tx-body">' +
                '<div class="gv-ft-tx-title">' + escapeHtml(title) + "</div>" +
                '<div class="gv-ft-tx-sub">' + escapeHtml(t.date || "") + "</div>" +
                "</div>" +
                '<div class="gv-ft-tx-amt ' + cls + '">' + escapeHtml(amtDisplay) + "</div>" +
                "</a>"
            );
        }).join("");
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    window.updateFintechDashboard = function(ctx) {
        ctxRef = ctx;

        var bank = ctx.account.cash || 0;
        var investment = 0;
        ctx.ALL_ASSETS.forEach(function(a) {
            investment += ctx.assetValue(a.key);
        });
        var savings = typeof ctx.getGoldInvestmentBalance === "function"
            ? ctx.getGoldInvestmentBalance(ctx.account)
            : 0;

        var total = ctx.portfolioValue();
        var totalFormatted = ctx.formatPrice(total);

        var hero = document.getElementById("heroPortfolioValue");
        if (hero) {
            hero.setAttribute("data-balance-mask", "1");
            hero.setAttribute("data-balance-value", totalFormatted);
            hero.textContent = maskText(totalFormatted);
        }

        setMaskedEl(document.getElementById("ftBankBalance"), ctx.formatPrice(bank));
        setMaskedEl(document.getElementById("ftInvestBalance"), ctx.formatPrice(investment));
        setMaskedEl(document.getElementById("ftSavingsBalance"), ctx.formatPrice(savings));

        var bankCh = formatChangePct(null);
        var invCh = formatChangePct(weightedInvestChangePct(ctx));
        var saveCh = formatChangePct(null);

        ["ftBankChange", "ftInvestChange", "ftSavingsChange"].forEach(function(id, i) {
            var el = document.getElementById(id);
            if (!el) return;
            var ch = [bankCh, invCh, saveCh][i];
            el.textContent = ch.text;
            el.className = "gv-ft-acct-change " + ch.cls;
        });

        var investPct = weightedInvestChangePct(ctx);
        drawSpark("ftSparkBank", "#00E89B", null);
        drawSpark("ftSparkInvest", "#00C8FF", investPct != null
            ? buildTrendFromChange(investPct)
            : null);
        drawSpark("ftSparkSave", "#FFBE45", null);

        renderRecentTransactions(ctx);
        applyBalanceMask(ctx);
    };

    function buildTrendFromChange(pct) {
        var base = 0.5;
        var drift = Math.max(-0.15, Math.min(0.15, pct / 20));
        var pts = [];
        for (var i = 0; i < 8; i++) {
            pts.push(base + drift * (i / 7));
        }
        return pts;
    }

    function initPrivacyToggle() {
        document.body.classList.toggle("balances-hidden", balancesHidden());
        updatePrivacyIcon(balancesHidden());
        var btn = document.getElementById("balancePrivacyToggle");
        if (btn) {
            btn.addEventListener("click", function() {
                setBalancesHidden(!balancesHidden());
            });
        }
    }

    function initMoreMenu() {
        var wrap = document.getElementById("moreQuickBtn");
        var menu = document.getElementById("ftMoreMenu");
        if (!wrap || !menu) return;
        wrap.addEventListener("click", function(e) {
            e.stopPropagation();
            menu.classList.toggle("hidden");
        });
        document.addEventListener("click", function() {
            menu.classList.add("hidden");
        });
        menu.addEventListener("click", function(e) {
            e.stopPropagation();
        });
        menu.querySelectorAll("[data-ft-more-href]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                window.location.href = btn.getAttribute("data-ft-more-href");
            });
        });
    }

    function initSidebarLogout() {
        var btn = document.getElementById("gvSidebarLogout");
        if (btn) {
            btn.addEventListener("click", function(e) {
                e.preventDefault();
                if (typeof logout === "function") logout();
            });
        }
    }

    function patchHeroGainMask() {
        var gain = document.getElementById("heroTodayGain");
        if (!gain) return;
        var observer = new MutationObserver(function() {
            if (!balancesHidden()) return;
            var raw = gain.getAttribute("data-gain-value");
            if (raw) gain.textContent = "Today's change hidden";
        });
        observer.observe(gain, { childList: true, characterData: true, subtree: true });
    }

    function wrapHeroAnimation() {
        if (window.__gvHeroWrapped) return;
        var prev = window.animateHeroPortfolio;
        if (typeof prev !== "function") return;
        window.__gvHeroWrapped = true;
        window.animateHeroPortfolio = function(amount, formatted) {
            var el = document.getElementById("heroPortfolioValue");
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

    document.addEventListener("DOMContentLoaded", function() {
        initPrivacyToggle();
        initMoreMenu();
        initSidebarLogout();
        patchHeroGainMask();
        wrapHeroAnimation();
        setTimeout(wrapHeroAnimation, 250);
    });
})();
