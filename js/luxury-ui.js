(function() {
    "use strict";

    var MARKET_SYMBOLS = [
        { id: "btc", name: "Bitcoin", symbol: "BTC", iconClass: "btc", coinId: "bitcoin" },
        { id: "eth", name: "Ethereum", symbol: "ETH", iconClass: "eth", coinId: "ethereum" },
        { id: "gold", name: "Gold", symbol: "XAU", iconClass: "gold", coinId: null, staticPrice: 2340 },
        { id: "oil", name: "Oil", symbol: "WTI", iconClass: "oil", coinId: null, staticPrice: 78.5 },
        { id: "tsla", name: "Tesla", symbol: "TSLA", iconClass: "tsla", coinId: null, staticPrice: 248 }
    ];

    function initLuxuryApp() {
        document.body.classList.add("lv-page-enter");
        if (!document.body.dataset.theme) {
            document.body.dataset.theme = "dark";
        }
        initWorldMap();
        initCounters();
        syncHeroMetrics();
        initBottomNav();
        initTransferFab();
        initMarketCards();
        initPortfolioHero();
        initCardHovers();
        observeAnimations();
    }

    function initWorldMap() {
        var canvas = document.getElementById("lvWorldMap");
        if (!canvas) return;

        var ctx = canvas.getContext("2d");
        var dots = [];
        var w = 0;
        var h = 0;

        function resize() {
            var parent = canvas.parentElement;
            if (!parent) return;
            w = parent.clientWidth;
            h = parent.clientHeight;
            canvas.width = w * 2;
            canvas.height = h * 2;
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
            ctx.setTransform(2, 0, 0, 2, 0, 0);
            if (!dots.length) {
                for (var i = 0; i < 48; i++) {
                    dots.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        r: 1 + Math.random() * 2,
                        phase: Math.random() * Math.PI * 2
                    });
                }
            }
        }

        function draw() {
            if (!w || !h) return;
            ctx.clearRect(0, 0, w, h);
            var t = Date.now() / 1000;

            ctx.strokeStyle = "rgba(109, 93, 246, 0.08)";
            ctx.lineWidth = 1;
            for (var i = 0; i < dots.length; i++) {
                for (var j = i + 1; j < dots.length; j++) {
                    var dx = dots[i].x - dots[j].x;
                    var dy = dots[i].y - dots[j].y;
                    if (dx * dx + dy * dy < 9000) {
                        ctx.beginPath();
                        ctx.moveTo(dots[i].x, dots[i].y);
                        ctx.lineTo(dots[j].x, dots[j].y);
                        ctx.stroke();
                    }
                }
            }

            dots.forEach(function(d) {
                var pulse = 0.5 + 0.5 * Math.sin(t * 1.5 + d.phase);
                ctx.beginPath();
                ctx.arc(d.x, d.y, d.r + pulse * 0.8, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(109, 93, 246, " + (0.15 + pulse * 0.25) + ")";
                ctx.fill();
            });

            requestAnimationFrame(draw);
        }

        resize();
        window.addEventListener("resize", resize);
        draw();
    }

    function parseMoney(text) {
        if (!text) return 0;
        var n = parseFloat(String(text).replace(/[^0-9.-]/g, ""));
        return isNaN(n) ? 0 : n;
    }

    function formatMoney(n) {
        var sign = n < 0 ? "-" : "";
        return sign + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function animateCounter(el, target, prefix, suffix) {
        if (!el || el.dataset.lvAnimated === "1") return;
        var start = 0;
        var duration = 900;
        var startTime = null;
        prefix = prefix || "";
        suffix = suffix || "";

        function step(ts) {
            if (!startTime) startTime = ts;
            var p = Math.min((ts - startTime) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            var val = start + (target - start) * eased;
            el.textContent = prefix + formatMoney(val).replace("$", "$") + suffix;
            if (p < 1) requestAnimationFrame(step);
            else el.dataset.lvAnimated = "1";
        }

        requestAnimationFrame(step);
    }

    function initCounters() {
        var hero = document.getElementById("heroPortfolioValue");
        if (hero && hero.textContent) {
            animateCounter(hero, parseMoney(hero.textContent));
        }
        var balance = document.getElementById("accountBalance");
        if (balance && balance.textContent) {
            animateCounter(balance, parseMoney(balance.textContent));
        }
    }

    function syncHeroMetrics() {
        var availEl = document.getElementById("lvAvailableBalance");
        var profitEl = document.getElementById("lvMonthlyProfit");
        var balanceSrc = document.getElementById("accountBalance");
        var plSrc = document.getElementById("plValue");

        if (availEl && balanceSrc) {
            var obs = new MutationObserver(function() {
                availEl.textContent = balanceSrc.textContent;
            });
            obs.observe(balanceSrc, { childList: true, characterData: true, subtree: true });
            availEl.textContent = balanceSrc.textContent;
        }

        if (profitEl && plSrc) {
            var obs2 = new MutationObserver(function() {
                profitEl.textContent = plSrc.textContent;
                profitEl.className = "lv-balance-sm lv-profit " + (plSrc.className || "");
            });
            obs2.observe(plSrc, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
            profitEl.textContent = plSrc.textContent;
        }
    }

    function getCurrentPage() {
        var path = window.location.pathname.split("/").pop() || "dashboard.html";
        if (path === "dashboard.html" || path === "") return "home";
        if (path === "exchange.html") return "markets";
        if (path === "wallet.html") return "portfolio";
        if (path === "settings.html" || path === "profile.html") return "account";
        if (path === "support.html") return "support";
        return "";
    }

    function bottomNavHtml(active) {
        return (
            '<nav class="lv-bottom-nav gv-mobile-nav" aria-label="Main navigation">' +
            '<a href="dashboard.html" class="lv-nav-item' + (active === "home" ? " active" : "") + '">' +
            '<span class="lv-nav-icon">🏠</span><span>Home</span></a>' +
            '<a href="exchange.html" class="lv-nav-item' + (active === "markets" ? " active" : "") + '">' +
            '<span class="lv-nav-icon">📈</span><span>Markets</span></a>' +
            '<div class="lv-nav-fab-wrap">' +
            '<button type="button" class="lv-nav-fab" id="lvTransferFab" aria-label="Transfer">⇄</button>' +
            '<span class="lv-nav-fab-label">Transfer</span></div>' +
            '<a href="wallet.html" class="lv-nav-item' + (active === "portfolio" ? " active" : "") + '">' +
            '<span class="lv-nav-icon">💼</span><span>Portfolio</span></a>' +
            '<a href="settings.html" class="lv-nav-item' + (active === "account" ? " active" : "") + '">' +
            '<span class="lv-nav-icon">👤</span><span>Account</span></a>' +
            '</nav>'
        );
    }

    function initBottomNav() {
        var existing = document.querySelector(".gv-mobile-nav, .lv-bottom-nav");
        var active = getCurrentPage();

        if (existing) {
            existing.outerHTML = bottomNavHtml(active);
        } else if (document.body.classList.contains("luxury-app")) {
            document.body.insertAdjacentHTML("beforeend", bottomNavHtml(active));
        }
    }

    function initTransferFab() {
        document.addEventListener("click", function(e) {
            var fab = e.target.closest("#lvTransferFab");
            if (!fab) return;
            e.preventDefault();
            window.location.href = "send-money.html";
        });
    }

    function miniChartSvg(up) {
        var color = up ? "#22C55E" : "#EF4444";
        return '<svg viewBox="0 0 120 40" preserveAspectRatio="none">' +
            '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' +
            (up ? "0,32 20,28 40,24 60,18 80,14 100,8 120,4" : "0,8 20,12 40,16 60,20 80,26 100,30 120,36") +
            '"/></svg>';
    }

    function renderMarketCard(item, price, change) {
        var up = change >= 0;
        var changeStr = (up ? "+" : "") + change.toFixed(2) + "%";
        var priceStr = item.coinId
            ? "$" + price.toLocaleString(undefined, { maximumFractionDigits: 0 })
            : (item.id === "gold" ? "$" + price.toFixed(0) + "/oz" : item.id === "oil" ? "$" + price.toFixed(2) + "/bbl" : "$" + price.toFixed(2));

        return (
            '<div class="lv-market-card lv-animate-in">' +
            '<div class="lv-market-card-head">' +
            '<div class="lv-market-icon ' + item.iconClass + '">' + (item.symbol === "BTC" ? "₿" : item.symbol === "ETH" ? "Ξ" : item.symbol.charAt(0)) + '</div>' +
            '<div><div class="lv-market-name">' + item.name + '</div><div class="lv-market-symbol">' + item.symbol + '</div></div>' +
            '</div>' +
            '<div class="lv-market-price">' + priceStr + '</div>' +
            '<div class="lv-market-change ' + (up ? "up" : "down") + '">' + changeStr + ' today</div>' +
            '<div class="lv-mini-chart">' + miniChartSvg(up) + '</div>' +
            '</div>'
        );
    }

    function initMarketCards() {
        var grid = document.getElementById("lvMarketsGrid");
        if (!grid) return;

        grid.innerHTML = MARKET_SYMBOLS.map(function(item) {
            return renderMarketCard(item, item.staticPrice || 0, Math.random() * 6 - 2);
        }).join("");

        var coinIds = MARKET_SYMBOLS.filter(function(m) { return m.coinId; }).map(function(m) { return m.coinId; }).join(",");
        if (!coinIds) return;

        fetch("https://api.coingecko.com/api/v3/simple/price?ids=" + coinIds + "&vs_currencies=usd&include_24hr_change=true")
            .then(function(r) { return r.json(); })
            .then(function(data) {
                grid.innerHTML = MARKET_SYMBOLS.map(function(item) {
                    if (item.coinId && data[item.coinId]) {
                        return renderMarketCard(item, data[item.coinId].usd, data[item.coinId].usd_24h_change || 0);
                    }
                    return renderMarketCard(item, item.staticPrice || 0, (Math.random() * 4 - 1));
                }).join("");
            })
            .catch(function() { /* keep static fallback */ });
    }

    function initPortfolioHero() {
        var hero = document.getElementById("lvPortfolioHero");
        if (!hero || typeof getCurrentAccount !== "function") return;

        try {
            var acct = getCurrentAccount();
            if (!acct) return;
            var cash = acct.balance || 0;
            var holdings = acct.holdings || {};
            var investTotal = 0;
            Object.keys(holdings).forEach(function(k) {
                investTotal += holdings[k].value || holdings[k].amount || 0;
            });

            hero.innerHTML =
                '<div class="lv-portfolio-stat lv-animate-in"><span>Total Investment</span><strong id="lvTotalInvest">' + formatMoney(investTotal) + '</strong></div>' +
                '<div class="lv-portfolio-stat lv-animate-in"><span>Current Value</span><strong id="lvCurrentValue">' + formatMoney(cash + investTotal) + '</strong></div>' +
                '<div class="lv-portfolio-stat lv-animate-in"><span>Cash Balance</span><strong>' + formatMoney(cash) + '</strong></div>' +
                '<div class="lv-portfolio-stat lv-animate-in"><span>Holdings</span><strong>' + Object.keys(holdings).length + '</strong></div>';

            var checking = document.getElementById("lvCheckingBalance");
            if (checking) checking.textContent = formatMoney(cash);
        } catch (e) { /* ignore */ }
    }

    function initCardHovers() {
        document.querySelectorAll(".card, .gv-stat-card, .lv-market-card").forEach(function(card) {
            card.addEventListener("mouseenter", function() {
                card.style.transform = "translateY(-3px)";
            });
            card.addEventListener("mouseleave", function() {
                card.style.transform = "";
            });
        });
    }

    function observeAnimations() {
        if (!("IntersectionObserver" in window)) return;
        var io = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("lv-visible");
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll(".lv-animate-in, .gv-animate-in").forEach(function(el) {
            io.observe(el);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initLuxuryApp);
    } else {
        initLuxuryApp();
    }

    window.addEventListener("globalvest-registry-synced", function() {
        initPortfolioHero();
        syncHeroMetrics();
    });
})();
