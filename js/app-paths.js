/**
 * Clean URL helpers — browser paths without .html (files on disk stay *.html).
 */
(function(global) {
    "use strict";

    var PUBLIC_PAGES = {
        index: true,
        login: true,
        dashboard: true,
        wallet: true,
        investments: true,
        "gold-investment": true,
        exchange: true,
        "send-money": true,
        settings: true,
        profile: true,
        support: true,
        "transfer-history": true,
        "investment-history": true,
        admin: true,
        "admin-dashboard": true
    };

    function stripHtmlExt(segment) {
        return String(segment || "").replace(/\.html$/i, "");
    }

    function pathnameSlug() {
        if (typeof window === "undefined") return "";
        var parts = window.location.pathname.split("/").filter(Boolean);
        if (!parts.length) return "index";
        var last = stripHtmlExt(parts[parts.length - 1] || "");
        if (parts.length >= 2 && parts[parts.length - 2] === "auth" && last === "callback") {
            return "auth/callback";
        }
        return last || "index";
    }

    function toCleanPath(page, suffix) {
        suffix = suffix || "";
        var raw = String(page || "").trim();
        if (!raw) return "/";
        if (/^https?:\/\//i.test(raw) || raw.indexOf("mailto:") === 0) return raw;

        var pathPart = raw;
        var hash = "";
        var query = "";
        var hashIdx = pathPart.indexOf("#");
        if (hashIdx !== -1) {
            hash = pathPart.slice(hashIdx);
            pathPart = pathPart.slice(0, hashIdx);
        }
        var queryIdx = pathPart.indexOf("?");
        if (queryIdx !== -1) {
            query = pathPart.slice(queryIdx);
            pathPart = pathPart.slice(0, queryIdx);
        }

        pathPart = pathPart.replace(/^\.\//, "").replace(/^\//, "");
        if (pathPart.indexOf("../") !== -1) {
            pathPart = pathPart.replace(/^\.\.\//, "");
        }
        pathPart = stripHtmlExt(pathPart);

        if (pathPart === "index" || pathPart === "") {
            return "/" + suffix + query + hash;
        }
        if (pathPart === "auth/callback") {
            return "/auth/callback" + suffix + query + hash;
        }
        return "/" + pathPart + suffix + query + hash;
    }

    function isSafeInternalNext(value) {
        var v = String(value || "").trim();
        if (!v || v.indexOf("://") !== -1 || v.indexOf("..") !== -1) return false;
        v = v.replace(/^\//, "");
        var base = stripHtmlExt(v.split("?")[0].split("#")[0]);
        if (!base || base === "login" || base.indexOf("login.html") === 0) return false;
        if (base === "auth/callback") return true;
        if (base.indexOf("/") !== -1) return false;
        return !!PUBLIC_PAGES[base];
    }

    function normalizeSafeHref(href) {
        var h = String(href || "").trim();
        if (!h || /^https?:\/\//i.test(h) || h.indexOf("mailto:") === 0 || h.indexOf("tel:") === 0) {
            return h;
        }
        if (!isSafeInternalNext(h.replace(/^\//, "")) && !/^#/.test(h)) {
            return "";
        }
        return toCleanPath(h);
    }

    function loginUrlWithNextFromLocation() {
        var slug = pathnameSlug();
        var path = slug === "index" ? "/" : toCleanPath(slug);
        var next = "";
        if (slug !== "login" && slug !== "index") {
            next = path + (window.location.search || "") + (window.location.hash || "");
            if (!isSafeInternalNext(next.replace(/^\//, ""))) next = "";
        }
        return toCleanPath("login") + (next ? "?next=" + encodeURIComponent(next.replace(/^\//, "")) : "");
    }

    function postLoginDestinationFromSearch() {
        var next = "";
        try {
            next = new URLSearchParams(window.location.search).get("next") || "";
        } catch (e) {
            next = "";
        }
        next = String(next).trim();
        if (next && isSafeInternalNext(next)) {
            return next.charAt(0) === "/" ? next : toCleanPath(next);
        }
        return toCleanPath("dashboard");
    }

    global.AppPaths = {
        PUBLIC_PAGES: PUBLIC_PAGES,
        pathnameSlug: pathnameSlug,
        toCleanPath: toCleanPath,
        isSafeInternalNext: isSafeInternalNext,
        normalizeSafeHref: normalizeSafeHref,
        loginUrlWithNextFromLocation: loginUrlWithNextFromLocation,
        postLoginDestinationFromSearch: postLoginDestinationFromSearch
    };
})(typeof window !== "undefined" ? window : globalThis);
