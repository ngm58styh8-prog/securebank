/**
 * Site-wide "demo project" disclaimer. Loaded in <head> on every page.
 */
(function() {
    "use strict";

    var BANNER_HEIGHT = 30;
    var FULL_TEXT = "DEMO PROJECT \u2014 Not a real bank. No real money is involved. Do not send real funds.";
    var SHORT_TEXT = "DEMO \u2014 Not a real bank. No real money.";
    var OFFSET_SELECTORS = "header, .gv-header, .admin-header, .gv-sidebar, .admin-sidebar";

    var root = document.documentElement;
    root.classList.add("gv-demo-mode");

    var style = document.createElement("style");
    style.textContent =
        "html.gv-demo-mode{--gv-demo-h:" + BANNER_HEIGHT + "px;padding-top:var(--gv-demo-h);}" +
        ".gv-demo-banner{position:fixed;top:0;left:0;right:0;height:var(--gv-demo-h);z-index:2147483000;" +
        "display:flex;align-items:center;justify-content:center;padding:0 12px;box-sizing:border-box;" +
        "background:#F5B700;color:#1F1600;font:700 12.5px/1 system-ui,-apple-system,'Segoe UI',sans-serif;" +
        "letter-spacing:0.02em;text-align:center;white-space:nowrap;overflow:hidden;" +
        "box-shadow:0 1px 0 rgba(0,0,0,0.25);}" +
        ".gv-demo-banner .gv-demo-short{display:none;}" +
        "@media (max-width:640px){.gv-demo-banner .gv-demo-full{display:none;}" +
        ".gv-demo-banner .gv-demo-short{display:inline;}}";
    (document.head || root).appendChild(style);

    function offsetPinnedElements() {
        var viewportHeight = window.innerHeight;
        document.querySelectorAll(OFFSET_SELECTORS).forEach(function(el) {
            if (el.closest(".gv-demo-banner")) return;
            if (el.dataset.gvDemoOffset === "1") return;
            var cs = window.getComputedStyle(el);
            if (cs.position !== "fixed" && cs.position !== "sticky") return;
            if (parseFloat(cs.top) !== 0) return;
            el.style.top = BANNER_HEIGHT + "px";
            if (cs.position === "fixed" && el.getBoundingClientRect().height >= viewportHeight - 1) {
                el.style.height = "calc(100vh - " + BANNER_HEIGHT + "px)";
                el.style.maxHeight = "calc(100vh - " + BANNER_HEIGHT + "px)";
            }
            el.dataset.gvDemoOffset = "1";
        });
    }

    function mount() {
        if (!document.querySelector(".gv-demo-banner")) {
            var banner = document.createElement("div");
            banner.className = "gv-demo-banner";
            banner.setAttribute("role", "note");
            banner.innerHTML =
                '<span class="gv-demo-full">' + FULL_TEXT + "</span>" +
                '<span class="gv-demo-short">' + SHORT_TEXT + "</span>";
            document.body.insertBefore(banner, document.body.firstChild);
        }
        offsetPinnedElements();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount);
    } else {
        mount();
    }
    window.addEventListener("load", offsetPinnedElements);
    window.addEventListener("resize", offsetPinnedElements);
})();
