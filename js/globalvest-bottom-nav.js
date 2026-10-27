/* GlobalVestBottomNavigation — renders the one shared mobile bottom nav on authenticated customer pages. */
(function() {
    "use strict";

    var ICONS = {
        home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        markets: '<path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5-5 5 5M12 5v12"/>',
        transfer: '<path d="M7 8h10M7 12h10M7 16h10M4 8l3-3 3 3M17 16l3 3 3-3"/>',
        portfolio: '<path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3v9l6.5 6.5"/>',
        account: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>'
    };

    var ITEMS = [
        { key: "home", label: "Home", href: "dashboard.html", pages: ["dashboard.html"] },
        { key: "markets", label: "Markets", href: "exchange.html", pages: ["exchange.html"] },
        { key: "transfer", label: "Transfer", href: "send-money.html", pages: ["send-money.html", "transfer-history.html"] },
        { key: "portfolio", label: "Investments", href: "investments.html", pages: ["investments.html", "investment-history.html", "wallet.html", "gold-investment.html"] },
        { key: "account", label: "Account", href: "settings.html", pages: ["settings.html", "profile.html", "support.html"] }
    ];

    function currentPage() {
        var file = window.location.pathname.split("/").pop() || "";
        if (!file || file === "/") return "dashboard.html";
        return file.indexOf(".") === -1 ? file + ".html" : file;
    }

    function activeKey() {
        var page = currentPage();
        for (var i = 0; i < ITEMS.length; i++) {
            if (ITEMS[i].pages.indexOf(page) !== -1) return ITEMS[i].key;
        }
        return "";
    }

    var MARKETS_ICON = "public/icons/globalvest-markets.svg";

    function svg(key, size) {
        if (key === "markets") {
            return '<img class="gv-markets-icon" src="' + MARKETS_ICON + '" alt="" width="' + size + '" height="' + size + '" aria-hidden="true">';
        }
        return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" ' +
            'stroke-width="' + (key === "transfer" ? "2.2" : "2") + '" aria-hidden="true">' + ICONS[key] + "</svg>";
    }

    function render(active) {
        return '<nav class="gv-bottom-nav" id="gvBottomNav" aria-label="Primary">' + ITEMS.map(function(item) {
            var isActive = item.key === active;
            var attrs = ' href="' + item.href + '" data-nav="' + item.key + '"' + (isActive ? ' aria-current="page"' : "");
            if (item.key === "transfer") {
                return '<a class="gv-bottom-nav-item gv-bottom-nav-transfer' + (isActive ? " active" : "") + '"' + attrs + ">" +
                    '<span class="gv-bottom-nav-fab">' + svg(item.key, 26) + "</span>" +
                    '<span class="gv-bottom-nav-label">' + item.label + "</span></a>";
            }
            var iconMarkup = item.key === "portfolio"
                ? '<svg class="gv-portfolio-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#00E89B" stroke-width="2" aria-hidden="true">' + ICONS.portfolio + "</svg>"
                : svg(item.key, 22);
            return '<a class="gv-bottom-nav-item' + (isActive ? " active" : "") + '"' + attrs + ">" +
                iconMarkup + '<span class="gv-bottom-nav-label">' + item.label + "</span></a>";
        }).join("") + "</nav>";
    }

    function mount() {
        var body = document.body;
        /* Customer pages are marked luxury-app; public, auth and admin pages are not. */
        if (!body || !body.classList.contains("luxury-app")) return null;

        document.querySelectorAll(".lv-bottom-nav, .gv-mobile-nav").forEach(function(el) { el.remove(); });

        var active = activeKey();
        var nav = document.getElementById("gvBottomNav");
        if (nav) {
            nav.querySelectorAll(".gv-bottom-nav-item").forEach(function(link) {
                var on = link.getAttribute("data-nav") === active;
                link.classList.toggle("active", on);
                if (on) link.setAttribute("aria-current", "page");
                else link.removeAttribute("aria-current");
            });
        } else {
            body.insertAdjacentHTML("beforeend", render(active));
            nav = document.getElementById("gvBottomNav");
        }
        body.classList.add("gv-has-bottom-nav");
        return nav;
    }

    window.GlobalVestBottomNavigation = { mount: mount, activeKey: activeKey, items: ITEMS };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount);
    } else {
        mount();
    }
    /* Pages restored from the back/forward cache keep their DOM; refresh the active state. */
    window.addEventListener("pageshow", function(e) { if (e.persisted) mount(); });
})();
