const username = requireAuth();
if (!username) throw new Error("Not authenticated");

let account = getAccount(username);
ensureSettings(username, account);
ensureExchangeHistory(account);
const settings = getSettings(account);

const REVIEW_MAX_AGE_MS = 60 * 1000;
const REFRESH_MS = 60 * 1000;
const VIEW_KEY = "gv_markets_view";

const state = {
    data: null,
    category: "all",
    query: "",
    sort: "mcap",
    view: localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list",
    filters: defaultFilters(),
    detailId: null,
    detailRange: null,
    review: null
};

let btcQuote = null;
let detailChart = null;
let chartLibPromise = null;

function $(id) { return document.getElementById(id); }

function esc(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function defaultFilters() {
    return { cats: ["crypto", "stocks", "commodities", "diamond"], minPrice: null, maxPrice: null, perf: "any", minCap: 0, minVol: 0 };
}

function formatPrice(amount) {
    return formatMoney(amount, settings.currency);
}

function formatUsd(value, opts) {
    opts = opts || {};
    if (value == null || !isFinite(value)) return "—";
    const abs = Math.abs(value);
    const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
    return "$" + value.toLocaleString("en-US", { minimumFractionDigits: opts.min != null ? opts.min : 2, maximumFractionDigits: digits });
}

function compactUsd(value) {
    if (value == null || !isFinite(value)) return "—";
    const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (let i = 0; i < units.length; i++) {
        if (Math.abs(value) >= units[i][0]) return "$" + (value / units[i][0]).toFixed(2) + units[i][1];
    }
    return "$" + value.toFixed(2);
}

function compactNumber(value) {
    if (value == null || !isFinite(value)) return "—";
    return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}

function formatChange(change) {
    if (change == null || !isFinite(change)) return "";
    return (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
}

function timeLabel(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function assetPriceText(asset) {
    const live = asset.live;
    if (asset.source === "none") return "Price Unavailable";
    if (live.status === "loading") return "";
    if (live.price == null) return "Market Data Unavailable";
    return formatUsd(live.price) + (asset.unit ? "/" + asset.unit : "");
}

function iconHtml(asset, extraClass) {
    return '<span class="mk-icon ' + (extraClass || "") + ' mk-icon-' + asset.category + '" style="--c:' + asset.color + '" aria-hidden="true">' +
        esc(asset.glyph) + "</span>";
}

/* Real price series → SVG sparkline. Returns an empty placeholder when there is no history. */
function sparkSvg(points, up, w, h) {
    w = w || 100;
    h = h || 32;
    if (!points || points.length < 2) return '<span class="mk-spark-empty">No chart data</span>';
    const step = Math.max(1, Math.floor(points.length / 60));
    const pts = points.filter(function(_, i) { return i % step === 0 || i === points.length - 1; });
    const min = Math.min.apply(null, pts);
    const max = Math.max.apply(null, pts);
    const span = max - min || 1;
    const coords = pts.map(function(p, i) {
        return (i / (pts.length - 1) * w).toFixed(1) + "," + (h - 2 - ((p - min) / span) * (h - 4)).toFixed(1);
    });
    const color = up ? "#00E89B" : "#FF4D5A";
    const gid = "mkg" + Math.random().toString(36).slice(2, 8);
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.28"/>' +
        '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
        '<polygon fill="url(#' + gid + ')" points="0,' + h + " " + coords.join(" ") + " " + w + "," + h + '"/>' +
        '<polyline fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="' + coords.join(" ") + '"/></svg>';
}

/* ---------- Filtering & sorting ---------- */

/* Each search term must start a word, so "eth" finds Ethereum but not Tether. */
function matchesQuery(asset, q) {
    if (!q) return true;
    const words = [asset.name, asset.symbol, asset.category, GVMarketData.categoryLabels[asset.category], asset.subtype || "",
        asset.category === "commodities" ? "commodity" : "", asset.category === "stocks" ? "stock equity" : ""]
        .join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return q.split(/[^a-z0-9]+/).filter(Boolean).every(function(term) {
        return words.some(function(w) { return w.indexOf(term) === 0; });
    });
}

function passesFilters(asset) {
    const f = state.filters;
    const live = asset.live;
    if (f.cats.indexOf(asset.category) === -1) return false;
    if (f.minPrice != null && !(live.price != null && live.price >= f.minPrice)) return false;
    if (f.maxPrice != null && !(live.price != null && live.price <= f.maxPrice)) return false;
    if (f.perf === "positive" && !(live.change24h != null && live.change24h > 0)) return false;
    if (f.perf === "negative" && !(live.change24h != null && live.change24h < 0)) return false;
    if (f.minCap > 0 && !(live.marketCap != null && live.marketCap >= f.minCap)) return false;
    if (f.minVol > 0 && !(live.volumeUsd != null && live.volumeUsd >= f.minVol)) return false;
    return true;
}

function activeFilterCount() {
    const f = state.filters;
    let n = 0;
    if (f.cats.length !== 4) n++;
    if (f.minPrice != null || f.maxPrice != null) n++;
    if (f.perf !== "any") n++;
    if (f.minCap > 0) n++;
    if (f.minVol > 0) n++;
    return n;
}

function nullsLast(a, b, dir) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return dir * (a - b);
}

function sortAssets(list) {
    const byName = function(a, b) { return a.name.localeCompare(b.name); };
    const sorters = {
        mcap: function(a, b) {
            return nullsLast(a.live.rank, b.live.rank, 1) || nullsLast(a.live.marketCap, b.live.marketCap, -1) ||
                (a.source === "none") - (b.source === "none") || 0;
        },
        "price-desc": function(a, b) { return nullsLast(a.live.price, b.live.price, -1) || byName(a, b); },
        "price-asc": function(a, b) { return nullsLast(a.live.price, b.live.price, 1) || byName(a, b); },
        gainers: function(a, b) { return nullsLast(a.live.change24h, b.live.change24h, -1) || byName(a, b); },
        losers: function(a, b) { return nullsLast(a.live.change24h, b.live.change24h, 1) || byName(a, b); },
        alpha: byName
    };
    return list.slice().sort(sorters[state.sort] || sorters.mcap);
}

function visibleAssets() {
    if (!state.data) return [];
    return sortAssets(state.data.assets.filter(function(a) {
        return (state.category === "all" || a.category === state.category) && matchesQuery(a, state.query) && passesFilters(a);
    }));
}

/* ---------- Rendering ---------- */

function renderSkeletons() {
    let html = "";
    for (let i = 0; i < 6; i++) html += '<div class="mk-asset mk-skel" aria-hidden="true"><span class="mk-skel-block"></span></div>';
    $("mkList").innerHTML = html;
}

function assetCardHtml(asset) {
    const live = asset.live;
    const up = live.change24h == null ? true : live.change24h >= 0;
    const unavailable = asset.source === "none" || (live.status !== "loading" && live.price == null);
    let changeHtml = "";
    if (live.change24h != null) changeHtml = '<span class="mk-chg ' + (up ? "up" : "down") + '">' + (up ? "▲ " : "▼ ") + formatChange(live.change24h).replace("+", "") + "</span>";
    else if (asset.source === "none") changeHtml = '<span class="mk-chg muted">No live feed</span>';
    else if (unavailable) changeHtml = '<span class="mk-chg muted">Unavailable</span>';
    const subtitle = asset.symbol + (asset.subtype ? " · " + asset.subtype : "");
    return '<button type="button" class="mk-asset' + (unavailable ? " is-unavailable" : "") + (asset.category === "diamond" ? " is-diamond" : "") +
        '" data-asset="' + asset.id + '" aria-label="' + esc(asset.name + " details") + '">' +
        '<span class="mk-rank">' + (live.rank ? live.rank : "") + "</span>" +
        iconHtml(asset) +
        '<span class="mk-id"><span class="mk-name">' + esc(asset.name) + '</span><span class="mk-sym">' + esc(subtitle) + "</span></span>" +
        '<span class="mk-spark" data-spark="' + asset.id + '" title="' + (live.sparkLabel ? live.sparkLabel + " price history" : "") + '"></span>' +
        '<span class="mk-quote-col"><span class="mk-price' + (unavailable ? " mk-price-na" : "") + '">' + esc(assetPriceText(asset)) + "</span>" + changeHtml + "</span>" +
        '<span class="mk-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>' +
        "</button>";
}

let sparkObserver = null;

function drawSpark(el) {
    const asset = getAsset(el.getAttribute("data-spark"));
    if (!asset) return;
    const live = asset.live;
    el.innerHTML = live.sparkline && live.sparkline.length > 1
        ? sparkSvg(live.sparkline, live.change24h == null ? live.sparkline[live.sparkline.length - 1] >= live.sparkline[0] : live.change24h >= 0)
        : "";
}

function renderList() {
    const list = $("mkList");
    list.dataset.view = state.view;
    if (!state.data) { renderSkeletons(); return; }
    const assets = visibleAssets();
    list.innerHTML = assets.map(assetCardHtml).join("");
    list.setAttribute("aria-busy", "false");
    $("mkEmpty").hidden = assets.length > 0;

    if (sparkObserver) sparkObserver.disconnect();
    const sparks = list.querySelectorAll("[data-spark]");
    if ("IntersectionObserver" in window) {
        sparkObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (!entry.isIntersecting) return;
                drawSpark(entry.target);
                sparkObserver.unobserve(entry.target);
            });
        }, { rootMargin: "200px" });
        sparks.forEach(function(el) { sparkObserver.observe(el); });
    } else {
        sparks.forEach(drawSpark);
    }
}

function setOverviewCard(id, value, sub, vizHtml, isUnavailable) {
    const card = $(id);
    const valueEl = card.querySelector('[data-field="value"]');
    valueEl.classList.remove("mk-skel-text");
    valueEl.textContent = value;
    valueEl.classList.toggle("mk-ov-na", !!isUnavailable);
    card.querySelector('[data-field="sub"]').innerHTML = sub;
    card.querySelector('[data-field="viz"]').innerHTML = vizHtml || "";
}

function renderOverview() {
    const data = state.data;
    if (!data) return;
    const g = data.global;
    if (g && g.marketCap) {
        const dom = g.dominance || {};
        const segs = [["BTC", dom.btc, "#F7931A"], ["ETH", dom.eth, "#8C8CF7"], ["USDT", dom.usdt, "#26A17B"]].filter(function(s) { return s[1] != null; });
        const other = Math.max(0, 100 - segs.reduce(function(sum, s) { return sum + s[1]; }, 0));
        const bar = '<div class="mk-dom-bar" role="img" aria-label="Market dominance">' + segs.map(function(s) {
            return '<span style="width:' + s[1].toFixed(2) + "%;background:" + s[2] + '"></span>';
        }).join("") + '<span style="width:' + other.toFixed(2) + '%;background:#0D5744"></span></div>' +
            '<div class="mk-dom-legend">' + segs.map(function(s) {
                return '<span><i style="background:' + s[2] + '"></i>' + s[0] + " " + s[1].toFixed(1) + "%</span>";
            }).join("") + "</div>";
        const ch = g.marketCapChange24h;
        setOverviewCard("mkOvCap", compactUsd(g.marketCap),
            ch != null ? '<span class="mk-chg ' + (ch >= 0 ? "up" : "down") + '">' + formatChange(ch) + "</span> 24h" : "", bar);

        const vols = data.assets.filter(function(a) { return a.category === "crypto" && a.live.volumeUsd; })
            .sort(function(a, b) { return b.live.volumeUsd - a.live.volumeUsd; }).slice(0, 4);
        const maxVol = vols.length ? vols[0].live.volumeUsd : 1;
        const bars = '<div class="mk-vol-bars">' + vols.map(function(a) {
            return '<div class="mk-vol-row"><span>' + a.symbol + '</span><span class="mk-vol-track"><span style="width:' +
                Math.max(4, a.live.volumeUsd / maxVol * 100).toFixed(1) + '%"></span></span><span>' + compactUsd(a.live.volumeUsd) + "</span></div>";
        }).join("") + "</div>";
        setOverviewCard("mkOvVol", compactUsd(g.volume), "Updated " + timeLabel(g.updatedAt) + (g.stale ? " · delayed" : ""), bars);
    } else {
        setOverviewCard("mkOvCap", "Unavailable", "Market-wide data could not be loaded.", "", true);
        setOverviewCard("mkOvVol", "Unavailable", "Market-wide data could not be loaded.", "", true);
    }

    const gainers = data.assets.filter(function(a) { return a.live.change24h != null && a.live.change24h > 0; })
        .sort(function(a, b) { return b.live.change24h - a.live.change24h; }).slice(0, 3);
    $("mkOvGainers").querySelector('[data-field="list"]').innerHTML = gainers.length ? gainers.map(function(a) {
        return '<button type="button" class="mk-gainer" data-asset="' + a.id + '">' + iconHtml(a, "sm") +
            '<span class="mk-gainer-sym">' + a.symbol + '</span><span class="mk-gainer-spark">' + sparkSvg(a.live.sparkline, true, 60, 20) +
            '</span><span class="mk-chg up">' + formatChange(a.live.change24h) + "</span></button>";
    }).join("") : '<p class="mk-ov-na-text">No assets are up in the last 24h, or data is unavailable.</p>';
}

function renderStatus() {
    const data = state.data;
    if (!data) return;
    const live = data.assets.filter(function(a) { return a.live.status === "live" || a.live.status === "delayed"; });
    const delayed = data.assets.some(function(a) { return a.live.status === "delayed"; });
    const newest = Math.max.apply(null, live.map(function(a) { return a.live.updatedAt || 0; }).concat([0]));
    $("mkUpdated").textContent = live.length
        ? "Last updated " + timeLabel(newest) + (delayed ? " · some prices delayed" : "") + " · auto-refreshes every minute"
        : "Market Data Unavailable";

    const notes = [];
    if (data.errors.coingecko) notes.push(data.errors.coingecko === "rate-limited"
        ? "Crypto prices are temporarily rate-limited by CoinGecko; showing the most recent cached data where available."
        : "Crypto and gold prices could not be loaded from CoinGecko.");
    if (data.errors.yahoo) notes.push("Stock, ETF and oil prices could not be loaded right now (Market Data Unavailable).");
    $("mkNotice").hidden = !notes.length;
    $("mkNotice").textContent = notes.join(" ");
}

function getAsset(id) {
    return state.data ? state.data.assets.find(function(a) { return a.id === id; }) : null;
}

function renderAll() {
    renderList();
    renderOverview();
    renderStatus();
    updateBtcQuoteFromData();
    if (state.detailId) renderDetail(false);
}

async function refreshMarkets(force) {
    state.data = await GVMarketData.loadAll(force);
    renderAll();
}

/* ---------- Controls ---------- */

function initControls() {
    const search = $("mkSearch");
    search.addEventListener("input", function() {
        state.query = search.value.trim().toLowerCase();
        $("mkSearchClear").hidden = !search.value;
        renderList();
    });
    $("mkSearchClear").addEventListener("click", function() {
        search.value = "";
        state.query = "";
        $("mkSearchClear").hidden = true;
        renderList();
        search.focus();
    });

    $("mkCats").addEventListener("click", function(e) {
        const btn = e.target.closest("[data-cat]");
        if (!btn) return;
        state.category = btn.getAttribute("data-cat");
        $("mkCats").querySelectorAll("[data-cat]").forEach(function(b) {
            const on = b === btn;
            b.classList.toggle("active", on);
            b.setAttribute("aria-selected", on ? "true" : "false");
        });
        btn.scrollIntoView({ block: "nearest", inline: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        renderList();
    });

    $("mkSort").addEventListener("change", function() {
        state.sort = this.value;
        renderList();
    });

    document.querySelectorAll(".mk-view-btn").forEach(function(btn) {
        btn.addEventListener("click", function() { setView(btn.getAttribute("data-view")); });
    });
    setView(state.view);

    document.addEventListener("click", function(e) {
        const card = e.target.closest("[data-asset]");
        if (card) openDetail(card.getAttribute("data-asset"));
    });

    initFilters();
}

function setView(view) {
    state.view = view === "grid" ? "grid" : "list";
    localStorage.setItem(VIEW_KEY, state.view);
    document.querySelectorAll(".mk-view-btn").forEach(function(b) {
        const on = b.getAttribute("data-view") === state.view;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("mkList").dataset.view = state.view;
}

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- Dialogs ---------- */

let lastFocus = null;

function openDialog(id) {
    const dlg = $(id);
    lastFocus = document.activeElement;
    dlg.hidden = false;
    document.body.classList.add("mk-dialog-open");
    const focusable = dlg.querySelector("[data-close]");
    if (focusable) focusable.focus({ preventScroll: true });
}

function closeDialog(id) {
    const dlg = $(id);
    if (dlg.hidden) return;
    dlg.hidden = true;
    if (!document.querySelector(".mk-dialog:not([hidden])")) document.body.classList.remove("mk-dialog-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

function initDialogs() {
    document.querySelectorAll(".mk-dialog").forEach(function(dlg) {
        dlg.addEventListener("click", function(e) {
            if (e.target === dlg || e.target.closest("[data-close]")) {
                if (dlg.id === "mkDetail") closeDetail();
                else closeDialog(dlg.id);
            }
        });
    });
    document.addEventListener("keydown", function(e) {
        if (e.key !== "Escape") return;
        const open = document.querySelector(".mk-dialog:not([hidden])");
        if (!open) return;
        if (open.id === "mkDetail") closeDetail();
        else closeDialog(open.id);
    });
}

/* ---------- Filters ---------- */

function initFilters() {
    const form = $("mkFilterForm");
    $("mkFilterBtn").addEventListener("click", function() {
        writeFilterForm();
        openDialog("mkFilters");
    });
    form.addEventListener("submit", function(e) {
        e.preventDefault();
        const fd = new FormData(form);
        const num = function(v) { return v === "" || v == null ? null : Math.max(0, Number(v)); };
        state.filters = {
            cats: fd.getAll("cat"),
            minPrice: num(fd.get("minPrice")),
            maxPrice: num(fd.get("maxPrice")),
            perf: fd.get("perf") || "any",
            minCap: Number(fd.get("minCap")) || 0,
            minVol: Number(fd.get("minVol")) || 0
        };
        applyFilterBadge();
        renderList();
        closeDialog("mkFilters");
    });
    $("mkFilterReset").addEventListener("click", function() {
        state.filters = defaultFilters();
        writeFilterForm();
        applyFilterBadge();
        renderList();
    });
}

function writeFilterForm() {
    const form = $("mkFilterForm");
    const f = state.filters;
    form.querySelectorAll('input[name="cat"]').forEach(function(cb) { cb.checked = f.cats.indexOf(cb.value) !== -1; });
    form.elements.minPrice.value = f.minPrice != null ? f.minPrice : "";
    form.elements.maxPrice.value = f.maxPrice != null ? f.maxPrice : "";
    form.querySelectorAll('input[name="perf"]').forEach(function(r) { r.checked = r.value === f.perf; });
    form.elements.minCap.value = String(f.minCap ? f.minCap.toExponential().replace("+", "") : 0);
    form.elements.minVol.value = String(f.minVol ? f.minVol.toExponential().replace("+", "") : 0);
}

function applyFilterBadge() {
    const n = activeFilterCount();
    $("mkFilterCount").hidden = n === 0;
    $("mkFilterCount").textContent = String(n);
    $("mkFilterBtn").classList.toggle("has-filters", n > 0);
}

/* ---------- Asset detail ---------- */

function openDetail(id, fromHistory) {
    const asset = getAsset(id);
    if (!asset) return;
    state.detailId = id;
    const ranges = GVMarketData.rangesFor(asset);
    state.detailRange = ranges.length ? (ranges.find(function(r) { return r[0] === "24h"; }) || ranges[0])[0] : null;
    if (!fromHistory && location.hash !== "#asset=" + id) history.pushState({ asset: id }, "", "#asset=" + id);
    renderDetail(true);
    if ($("mkDetail").hidden) openDialog("mkDetail");
}

function closeDetail(fromHistory) {
    if (!state.detailId) return;
    state.detailId = null;
    closeDialog("mkDetail");
    if (!fromHistory && /^#asset=/.test(location.hash)) {
        if (history.state && history.state.asset) history.back();
        else history.replaceState(null, "", location.pathname + location.search);
    }
}

function syncDetailWithHash() {
    const m = location.hash.match(/^#asset=([a-z0-9-]+)/);
    if (m && getAsset(m[1])) {
        if (state.detailId !== m[1]) openDetail(m[1], true);
    } else if (state.detailId) {
        closeDetail(true);
    }
}

function statRow(label, value) {
    return "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>";
}

function renderDetail(reloadChart) {
    const asset = getAsset(state.detailId);
    if (!asset) return;
    const live = asset.live;
    $("mkDetailIcon").outerHTML = '<span class="mk-icon mk-icon-' + asset.category + '" id="mkDetailIcon" style="--c:' + asset.color + '" aria-hidden="true">' + esc(asset.glyph) + "</span>";
    $("mkDetailName").textContent = asset.name;
    $("mkDetailSym").textContent = asset.symbol + " · " + GVMarketData.categoryLabels[asset.category] + (asset.subtype ? " · " + asset.subtype : "");
    $("mkDetailPrice").textContent = assetPriceText(asset) || "Loading…";
    const chg = $("mkDetailChange");
    chg.className = "mk-chg " + (live.change24h == null ? "muted" : live.change24h >= 0 ? "up" : "down");
    chg.textContent = live.change24h != null ? formatChange(live.change24h) + " (24h)" : "";

    const ranges = GVMarketData.rangesFor(asset);
    $("mkDetailRanges").innerHTML = ranges.map(function(r) {
        const on = r[0] === state.detailRange;
        return '<button type="button" role="tab" class="mk-range-btn' + (on ? " active" : "") + '" aria-selected="' + on + '" data-range="' + r[0] + '">' + r[1] + "</button>";
    }).join("");
    $("mkDetailRanges").hidden = !ranges.length;

    const rows = [];
    if (asset.category === "diamond") {
        const d = asset.diamond;
        rows.push(statRow("Diamond type", d.type), statRow("Carat weight", d.carat), statRow("Quality / grade", d.grade),
            statRow("Pricing unit", d.unit), statRow("Currency", d.currency), statRow("Data source", d.source), statRow("Last updated", "—"));
    } else {
        if (live.rank) rows.push(statRow("Market cap rank", "#" + live.rank));
        if (live.marketCap != null) rows.push(statRow("Market cap", compactUsd(live.marketCap)));
        if (live.volumeUsd != null) rows.push(statRow("24h volume", compactUsd(live.volumeUsd)));
        if (live.volume != null) rows.push(statRow("Volume", compactNumber(live.volume) + (asset.category === "stocks" ? " shares" : " contracts")));
        if (live.high24h != null) rows.push(statRow(asset.source === "yahoo" ? "Day high" : "24h high", formatUsd(live.high24h)));
        if (live.low24h != null) rows.push(statRow(asset.source === "yahoo" ? "Day low" : "24h low", formatUsd(live.low24h)));
        if (live.fiftyTwoWeekHigh != null) rows.push(statRow("52-week high", formatUsd(live.fiftyTwoWeekHigh)));
        if (live.fiftyTwoWeekLow != null) rows.push(statRow("52-week low", formatUsd(live.fiftyTwoWeekLow)));
        if (live.exchange) rows.push(statRow("Exchange", live.exchange));
        rows.push(statRow("Data source", live.sourceLabel || "—"));
        rows.push(statRow("Last updated", timeLabel(live.updatedAt) + (live.stale ? " (delayed)" : "")));
    }
    $("mkDetailStats").innerHTML = rows.join("");
    $("mkDetailNote").hidden = !asset.note;
    $("mkDetailNote").textContent = asset.note || "";

    const actions = [];
    if (asset.id === "btc") actions.push('<button type="button" class="mk-primary" id="mkDetailConvert">Convert BTC ↔ Cash</button>');
    $("mkDetailActions").innerHTML = actions.join("");
    $("mkDetailActions").hidden = !actions.length;
    const convertBtn = $("mkDetailConvert");
    if (convertBtn) convertBtn.addEventListener("click", function() {
        closeDetail();
        $("mkConvert").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        $("convertAmount").focus({ preventScroll: true });
    });

    if (reloadChart) loadDetailChart();
}

function loadChartLib() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (chartLibPromise) return chartLibPromise;
    chartLibPromise = new Promise(function(resolve, reject) {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chart.js";
        s.async = true;
        s.onload = function() { resolve(window.Chart); };
        s.onerror = function() { chartLibPromise = null; reject(new Error("Chart library failed to load")); };
        document.head.appendChild(s);
    });
    return chartLibPromise;
}

function chartMessage(text) {
    const msg = $("mkDetailChartMsg");
    msg.hidden = !text;
    msg.textContent = text || "";
    $("mkDetailChart").style.visibility = text ? "hidden" : "visible";
}

async function loadDetailChart() {
    const asset = getAsset(state.detailId);
    if (!asset) return;
    if (asset.source === "none") {
        if (detailChart) { detailChart.destroy(); detailChart = null; }
        chartMessage("No verified diamond price history is available.");
        return;
    }
    const range = state.detailRange;
    const requestId = asset.id + ":" + range;
    $("mkDetailChartWrap").dataset.request = requestId;
    chartMessage("Loading chart…");
    try {
        const results = await Promise.all([GVMarketData.history(asset, range), loadChartLib()]);
        if ($("mkDetailChartWrap").dataset.request !== requestId || state.detailId !== asset.id) return;
        const points = results[0].points;
        if (!points || points.length < 2) { chartMessage("No price history is available for this range."); return; }
        const up = points[points.length - 1][1] >= points[0][1];
        const color = up ? "#00E89B" : "#FF4D5A";
        const canvas = $("mkDetailChart");
        const ctx = canvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
        grad.addColorStop(0, up ? "rgba(0,232,155,0.28)" : "rgba(255,77,90,0.28)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        const longRange = range === "1y" || range === "all" || range === "30d";
        const labels = points.map(function(p) {
            const d = new Date(p[0]);
            return longRange ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: range === "all" ? "numeric" : undefined })
                : d.toLocaleString(undefined, { weekday: range === "7d" ? "short" : undefined, hour: "2-digit", minute: "2-digit" });
        });
        if (detailChart) detailChart.destroy();
        chartMessage("");
        detailChart = new Chart(ctx, {
            type: "line",
            data: { labels: labels, datasets: [{ data: points.map(function(p) { return p[1]; }), borderColor: color, backgroundColor: grad, fill: true, borderWidth: 2, pointRadius: 0, tension: 0.25 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: prefersReducedMotion() ? false : { duration: 400 },
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function(c) { return formatUsd(c.parsed.y); } } }
                },
                scales: {
                    x: { ticks: { color: "#A6B5AF", maxTicksLimit: 5, maxRotation: 0 }, grid: { display: false } },
                    y: { position: "right", ticks: { color: "#A6B5AF", maxTicksLimit: 5, callback: function(v) { return compactUsd(v); } }, grid: { color: "rgba(13,87,68,0.35)" } }
                }
            }
        });
    } catch (err) {
        if ($("mkDetailChartWrap").dataset.request !== requestId) return;
        chartMessage(err && err.message === "rate-limited"
            ? "Chart data is temporarily rate-limited. Please try again in a minute."
            : "Market Data Unavailable — price history could not be loaded.");
    }
}

function initDetail() {
    $("mkDetailRanges").addEventListener("click", function(e) {
        const btn = e.target.closest("[data-range]");
        if (!btn || btn.getAttribute("data-range") === state.detailRange) return;
        state.detailRange = btn.getAttribute("data-range");
        renderDetail(true);
    });
    window.addEventListener("popstate", syncDetailWithHash);
    window.addEventListener("hashchange", syncDetailWithHash);
}

/* ---------- Crypto ↔ Cash conversion ---------- */

function btcHolding() {
    return account.holdings && account.holdings.btc ? account.holdings.btc : 0;
}

function updateBtcQuoteFromData() {
    const btc = getAsset("btc");
    if (btc && btc.live.price != null && !btc.live.stale) {
        btcQuote = { price: btc.live.price, at: btc.live.updatedAt || Date.now() };
    } else if (btc && btc.live.price == null) {
        btcQuote = null;
    }
    updateConvertQuote();
}

/* Fresh BTC/USD rate straight from CoinGecko for the review step; never falls back to a made-up price. */
async function fetchFreshBtcPrice() {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true");
    if (!r.ok) throw new Error(r.status === 429 ? "The rate provider is busy. Try again in a minute." : "Live BTC rate unavailable.");
    const data = await r.json();
    const price = data && data.bitcoin && data.bitcoin.usd;
    if (!price || !isFinite(price)) throw new Error("Live BTC rate unavailable.");
    return { price: price, at: data.bitcoin.last_updated_at ? data.bitcoin.last_updated_at * 1000 : Date.now() };
}

function convertDirection() {
    return $("convertFrom").value === "USD" ? "cash-to-btc" : "btc-to-cash";
}

function updateConvertQuote() {
    const direction = convertDirection();
    const amount = parseFloat($("convertAmount").value);
    $("convertUnit").textContent = direction === "cash-to-btc" ? "(USD)" : "(BTC)";
    $("convertAmount").placeholder = direction === "cash-to-btc" ? "100.00" : "0.001";
    $("convertAvailable").textContent = direction === "cash-to-btc" ? formatPrice(account.cash || 0) : btcHolding().toFixed(8) + " BTC";
    const status = $("mkRateStatus");
    if (!btcQuote) {
        $("convertRate").textContent = "Live rate unavailable";
        $("convertReceive").textContent = "—";
        status.textContent = "Rate unavailable";
        status.classList.add("is-down");
        return;
    }
    status.textContent = "Live · " + timeLabel(btcQuote.at);
    status.classList.remove("is-down");
    $("convertRate").textContent = "1 BTC = " + formatUsd(btcQuote.price);
    if (!amount || amount <= 0) { $("convertReceive").textContent = "—"; return; }
    $("convertReceive").textContent = direction === "cash-to-btc"
        ? "≈ " + (amount / btcQuote.price).toFixed(8) + " BTC"
        : "≈ " + formatPrice(amount * btcQuote.price);
}

function showFormError(id, text) {
    $(id).hidden = !text;
    $(id).textContent = text || "";
}

function validateConversion(amount, direction) {
    if (!amount || !isFinite(amount) || amount <= 0) return "Enter a valid amount.";
    if (direction === "cash-to-btc" && (account.cash || 0) < amount) return "Insufficient cash balance.";
    if (direction === "btc-to-cash" && btcHolding() < amount) return "Insufficient BTC balance.";
    return null;
}

async function openReview() {
    account = getAccount(username) || account;
    const direction = convertDirection();
    const amount = parseFloat($("convertAmount").value);
    const err = validateConversion(amount, direction);
    if (err) { showFormError("convertError", err); return; }
    showFormError("convertError", "");
    const btn = $("convertReviewBtn");
    btn.disabled = true;
    btn.textContent = "Fetching live rate…";
    try {
        const quote = await fetchFreshBtcPrice();
        btcQuote = quote;
        updateConvertQuote();
        state.review = { amount: amount, direction: direction, price: quote.price, at: Date.now() };
        renderReview();
        showFormError("mkReviewError", "");
        openDialog("mkReview");
    } catch (e) {
        showFormError("convertError", e.message + " No conversion was made.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Review Conversion";
    }
}

function renderReview() {
    const r = state.review;
    const toBtc = r.direction === "cash-to-btc";
    const receive = toBtc ? (r.amount / r.price).toFixed(8) + " BTC" : formatPrice(r.amount * r.price);
    $("mkReviewBody").innerHTML =
        statRow("From", toBtc ? formatPrice(r.amount) + " USD Cash" : r.amount.toFixed(8) + " BTC") +
        statRow("To", toBtc ? "Bitcoin (BTC)" : "USD Cash") +
        statRow("Exchange rate", "1 BTC = " + formatUsd(r.price)) +
        statRow("Fees", "$0.00") +
        '<div class="mk-quote-total"><dt>You receive</dt><dd>' + esc(receive) + "</dd></div>" +
        statRow("Rate time", timeLabel(r.at));
}

async function confirmReview() {
    const r = state.review;
    if (!r) return;
    const btn = $("mkReviewConfirm");
    btn.disabled = true;
    try {
        if (Date.now() - r.at > REVIEW_MAX_AGE_MS) {
            const quote = await fetchFreshBtcPrice();
            r.price = quote.price;
            r.at = Date.now();
            btcQuote = quote;
            renderReview();
            showFormError("mkReviewError", "The rate was refreshed because the review expired. Please check it and confirm again.");
            return;
        }
        account = getAccount(username) || account;
        const err = validateConversion(r.amount, r.direction);
        if (err) { showFormError("mkReviewError", err); return; }
        const result = convertCryptoCash(r.amount, r.direction, r.price);
        if (!result.ok) { showFormError("mkReviewError", result.error); return; }
        saveAccount(username, account);
        state.review = null;
        closeDialog("mkReview");
        $("convertAmount").value = "";
        updateConvertQuote();
        renderExchangeHistory();
        toast(result.message);
    } catch (e) {
        showFormError("mkReviewError", e.message + " No conversion was made.");
    } finally {
        btn.disabled = false;
    }
}

function exchangeRef() {
    return "EX-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function convertCryptoCash(amount, direction, btcPrice) {
    if (!btcPrice) return { ok: false, error: "BTC price unavailable. Try again shortly." };
    if (!account.holdings) account.holdings = {};
    if (account.holdings.btc == null) account.holdings.btc = 0;
    const ref = exchangeRef();
    const rateText = "1 BTC = " + formatUsd(btcPrice);

    if (direction === "cash-to-btc") {
        if (account.cash < amount) return { ok: false, error: "Insufficient cash balance." };
        const btcReceived = amount / btcPrice;
        account.cash -= amount;
        account.holdings.btc += btcReceived;
        account.transactions.unshift({
            date: new Date().toLocaleString(),
            description: "Exchange: Cash → " + btcReceived.toFixed(8) + " BTC",
            amount: -amount
        });
        ensureExchangeHistory(account).unshift({
            id: Date.now() + Math.random(),
            time: new Date().toISOString(),
            date: new Date().toLocaleString(),
            type: "Crypto ↔ Cash",
            details: "Cash → BTC",
            amount: formatPrice(amount) + " → " + btcReceived.toFixed(8) + " BTC",
            rate: rateText,
            status: "Completed",
            ref: ref
        });
        if (typeof pushAccountNotification === "function") {
            pushAccountNotification(account,
                "Converted " + formatPrice(amount) + " to " + btcReceived.toFixed(8) + " BTC",
                { type: "trade" }
            );
        }
        return { ok: true, message: "Converted " + formatPrice(amount) + " to " + btcReceived.toFixed(8) + " BTC." };
    }

    if (account.holdings.btc < amount) return { ok: false, error: "Insufficient BTC balance." };
    const cashReceived = amount * btcPrice;
    account.holdings.btc -= amount;
    account.cash += cashReceived;
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Exchange: " + amount.toFixed(8) + " BTC → Cash",
        amount: cashReceived
    });
    ensureExchangeHistory(account).unshift({
        id: Date.now() + Math.random(),
        time: new Date().toISOString(),
        date: new Date().toLocaleString(),
        type: "Crypto ↔ Cash",
        details: "BTC → Cash",
        amount: amount.toFixed(8) + " BTC → " + formatPrice(cashReceived),
        rate: rateText,
        status: "Completed",
        ref: ref
    });
    if (typeof pushAccountNotification === "function") {
        pushAccountNotification(account,
            "Converted " + amount.toFixed(8) + " BTC to " + formatPrice(cashReceived),
            { type: "trade" }
        );
    }
    return { ok: true, message: "Converted " + amount.toFixed(8) + " BTC to " + formatPrice(cashReceived) + "." };
}

function initConvert() {
    const from = $("convertFrom");
    const to = $("convertTo");
    function syncPair(changed) {
        if (changed === from) to.value = from.value === "USD" ? "BTC" : "USD";
        else from.value = to.value === "USD" ? "BTC" : "USD";
        showFormError("convertError", "");
        updateConvertQuote();
    }
    from.addEventListener("change", function() { syncPair(from); });
    to.addEventListener("change", function() { syncPair(to); });
    $("convertSwap").addEventListener("click", function() {
        from.value = from.value === "USD" ? "BTC" : "USD";
        syncPair(from);
    });
    $("convertAmount").addEventListener("input", function() {
        showFormError("convertError", "");
        updateConvertQuote();
    });
    $("convertForm").addEventListener("submit", function(e) {
        e.preventDefault();
        openReview();
    });
    $("mkReviewConfirm").addEventListener("click", confirmReview);
}

/* ---------- Currency converter (reference rates) ---------- */

function runFxConvert() {
    const amount = parseFloat($("fxAmount").value);
    const from = $("fxFrom").value;
    const to = $("fxTo").value;
    if (!amount || amount <= 0) {
        $("fxResult").textContent = "Enter a valid amount.";
        return;
    }
    const usd = amount / FX_RATES[from];
    const converted = usd * FX_RATES[to];
    const symbols = { USD: "$", EUR: "€", GBP: "£" };
    $("fxResult").textContent =
        symbols[from] + amount.toFixed(2) + " " + from + " = " +
        symbols[to] + converted.toFixed(2) + " " + to;
    account = getAccount(username) || account;
    ensureExchangeHistory(account).unshift({
        id: Date.now() + Math.random(),
        time: new Date().toISOString(),
        date: new Date().toLocaleString(),
        type: "Currency",
        details: from + " → " + to,
        amount: amount.toFixed(2) + " " + from + " → " + converted.toFixed(2) + " " + to,
        rate: "1 " + from + " = " + (FX_RATES[to] / FX_RATES[from]).toFixed(4) + " " + to,
        status: "Calculated",
        ref: exchangeRef()
    });
    saveAccount(username, account);
    renderExchangeHistory();
}

/* ---------- Exchange history ---------- */

function legacyRef(item) {
    const n = Math.floor(Number(item.id) || 0);
    return n ? "EX-" + n.toString(36).toUpperCase() : "—";
}

function renderExchangeHistory() {
    const list = $("exchangeHistoryList");
    const history = (account.exchangeHistory || []).slice(0, 50);
    $("mkHistoryCount").textContent = String((account.exchangeHistory || []).length);
    if (!history.length) {
        list.innerHTML = '<li class="mk-history-empty">No exchanges yet. Conversions you make will appear here.</li>';
        return;
    }
    list.innerHTML = history.map(function(item) {
        const isCrypto = /crypto/i.test(item.type || "");
        const status = item.status || "Completed";
        return '<li class="mk-tx">' +
            '<span class="mk-tx-ico ' + (isCrypto ? "is-crypto" : "is-fx") + '" aria-hidden="true">' + (isCrypto ? "₿" : "¤") + "</span>" +
            '<div class="mk-tx-main"><div class="mk-tx-top"><span class="mk-tx-title">' + esc(item.details || item.type) + '</span>' +
            '<span class="mk-tx-status s-' + esc(status.toLowerCase()) + '">' + esc(status) + "</span></div>" +
            '<div class="mk-tx-amt">' + esc(item.amount) + "</div>" +
            '<div class="mk-tx-meta"><span>' + esc(item.rate || "Rate not recorded") + "</span><span>" + esc(item.date) + "</span>" +
            '<span class="mk-tx-ref">Ref ' + esc(item.ref || legacyRef(item)) + "</span></div></div></li>";
    }).join("");
}

/* ---------- Shell: menu, account dropdown, toast ---------- */

function initShell() {
    const sidebar = $("gvSidebar");
    const toggle = $("sidebarToggle");
    const scrim = $("mkScrim");
    function setOpen(open) {
        sidebar.classList.toggle("open", open);
        scrim.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    toggle.addEventListener("click", function() { setOpen(!sidebar.classList.contains("open")); });
    scrim.addEventListener("click", function() { setOpen(false); });
    sidebar.addEventListener("click", function(e) { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", function(e) { if (e.key === "Escape") setOpen(false); });

    const accBtn = $("mkAccountBtn");
    const menu = $("mkAccountMenu");
    accBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        const open = menu.classList.toggle("hidden") === false;
        accBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function(e) {
        if (!menu.classList.contains("hidden") && !e.target.closest("#mkAccountMenu")) {
            menu.classList.add("hidden");
            accBtn.setAttribute("aria-expanded", "false");
        }
    });
    const name = account.profile && (account.profile.fullName || account.profile.name);
    if (name) $("mkAccountName").textContent = "👤 " + name;

    $("gvSidebarLogout").addEventListener("click", function() {
        clearSession();
        window.location.href = "login.html";
    });
}

let toastTimer = null;
function toast(text) {
    const el = $("mkToast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.hidden = true; }, 4500);
}

/* ---------- Boot ---------- */

initPageNav("exchange");
initShell();
initDialogs();
initControls();
initDetail();
initConvert();
renderSkeletons();
updateConvertQuote();
renderExchangeHistory();
$("fxConvertBtn").addEventListener("click", runFxConvert);

refreshMarkets(false).then(function() {
    syncDetailWithHash();
});

setInterval(function() {
    if (!document.hidden) refreshMarkets(false);
}, REFRESH_MS);

document.addEventListener("visibilitychange", function() {
    if (!document.hidden) refreshMarkets(false);
});

window.addEventListener("globalvest-accounts-changed", function() {
    account = getAccount(username) || account;
    updateConvertQuote();
    renderExchangeHistory();
});
