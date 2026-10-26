(function() {
    "use strict";

    function initLuxuryApp() {
        document.body.classList.add("lv-page-enter");
        /* An empty data-theme means light mode (see applyThemeToDocument); only default when the attribute is absent. */
        if (!document.body.hasAttribute("data-theme")) {
            document.body.dataset.theme = "dark";
        }
        initWorldMap();
        initCounters();
        syncHeroMetrics();
        initBottomNav();
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

            ctx.strokeStyle = "rgba(62, 224, 160, 0.10)";
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
                ctx.fillStyle = "rgba(62, 224, 160, " + (0.12 + pulse * 0.22) + ")";
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
        /* The fintech dashboard drives the hero balance itself; animating the static placeholder would overwrite it. */
        if (hero && hero.textContent && !document.querySelector(".gv-ft-hero")) {
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

    function initBottomNav() {
        if (window.GlobalVestBottomNavigation) {
            window.GlobalVestBottomNavigation.mount();
        }
    }

    function initPortfolioHero() {
        var hero = document.getElementById("lvPortfolioHero");
        if (!hero || typeof getCurrentAccount !== "function") return; /* wallet.js renders real account panels */

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
