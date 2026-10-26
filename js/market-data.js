/* GlobalVest market data layer.
   Crypto and gold come from CoinGecko (browser CORS allowed); equities, ETFs and WTI oil come from Yahoo Finance
   through /api/market-data because Yahoo blocks browser requests. Nothing here invents a price: an asset without
   data reports status "unavailable". */
(function() {
    "use strict";

    var COINGECKO = "https://api.coingecko.com/api/v3";
    var MARKET_API = "/api/market-data";
    var CACHE_PREFIX = "gvmkt:v1:";
    var QUOTE_TTL = 60 * 1000;
    var GLOBAL_TTL = 5 * 60 * 1000;
    var HISTORY_TTL = 5 * 60 * 1000;
    var SHORT_HISTORY_TTL = 60 * 1000;
    var BACKOFF_MS = 90 * 1000;

    var ASSETS = [
        { id: "btc", name: "Bitcoin", symbol: "BTC", category: "crypto", source: "coingecko", coinId: "bitcoin", glyph: "₿", color: "#F7931A" },
        { id: "eth", name: "Ethereum", symbol: "ETH", category: "crypto", source: "coingecko", coinId: "ethereum", glyph: "Ξ", color: "#8C8CF7" },
        { id: "usdt", name: "Tether", symbol: "USDT", category: "crypto", source: "coingecko", coinId: "tether", glyph: "₮", color: "#26A17B" },
        { id: "bnb", name: "BNB", symbol: "BNB", category: "crypto", source: "coingecko", coinId: "binancecoin", glyph: "◆", color: "#F3BA2F" },
        { id: "sol", name: "Solana", symbol: "SOL", category: "crypto", source: "coingecko", coinId: "solana", glyph: "◎", color: "#14F195" },
        { id: "xrp", name: "XRP", symbol: "XRP", category: "crypto", source: "coingecko", coinId: "ripple", glyph: "✕", color: "#B9C6D2" },
        { id: "gold", name: "Gold", symbol: "XAU", category: "commodities", source: "coingecko", coinId: "pax-gold", glyph: "Au", color: "#FFBE45", unit: "oz",
            note: "Spot gold tracked via PAX Gold (PAXG), a token redeemable 1:1 for a troy ounce of London Good Delivery gold.", hideMarketCap: true },
        { id: "oil", name: "Oil", symbol: "WTI", category: "commodities", source: "yahoo", yahoo: "CL=F", glyph: "🛢", color: "#C9A27A", unit: "bbl",
            note: "NYMEX WTI crude oil front-month futures (CL=F)." },
        { id: "tsla", name: "Tesla", symbol: "TSLA", category: "stocks", source: "yahoo", yahoo: "TSLA", glyph: "T", color: "#E82127" },
        { id: "aapl", name: "Apple", symbol: "AAPL", category: "stocks", source: "yahoo", yahoo: "AAPL", glyph: "A", color: "#D6D6D6" },
        { id: "googl", name: "Alphabet", symbol: "GOOGL", category: "stocks", source: "yahoo", yahoo: "GOOGL", glyph: "G", color: "#4285F4" },
        { id: "msft", name: "Microsoft", symbol: "MSFT", category: "stocks", source: "yahoo", yahoo: "MSFT", glyph: "⊞", color: "#00A4EF" },
        { id: "nvda", name: "NVIDIA", symbol: "NVDA", category: "stocks", source: "yahoo", yahoo: "NVDA", glyph: "N", color: "#76B900" },
        { id: "spy", name: "SPDR S&P 500 ETF", symbol: "SPY", category: "stocks", subtype: "ETF", source: "yahoo", yahoo: "SPY", glyph: "S", color: "#00E89B" },
        { id: "qqq", name: "Invesco QQQ ETF", symbol: "QQQ", category: "stocks", subtype: "ETF", source: "yahoo", yahoo: "QQQ", glyph: "Q", color: "#8BFFD0" },
        { id: "vti", name: "Vanguard Total Market ETF", symbol: "VTI", category: "stocks", subtype: "ETF", source: "yahoo", yahoo: "VTI", glyph: "V", color: "#C8102E" },
        { id: "diamond", name: "Diamond", symbol: "DIAMOND", category: "diamond", source: "none", glyph: "💎", color: "#00D9FF",
            diamond: {
                type: "Natural polished diamond",
                carat: "Not specified",
                grade: "Not specified",
                unit: "USD per carat",
                currency: "USD",
                source: "No verified diamond pricing feed is connected"
            },
            note: "Diamond prices are set per stone by carat, cut, colour and clarity; there is no standardised live exchange price. GlobalVest will only display a diamond price once a licensed pricing source is connected." }
    ];

    var CATEGORY_LABELS = { crypto: "Crypto", stocks: "Stocks", commodities: "Commodities", diamond: "Diamond" };

    var RANGES = {
        coingecko: [["1h", "1H"], ["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["1y", "1Y"]],
        yahoo: [["1h", "1H"], ["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["1y", "1Y"], ["all", "ALL"]],
        none: []
    };
    var COINGECKO_DAYS = { "1h": 1, "24h": 1, "7d": 7, "30d": 30, "1y": 365 };

    var inflight = {};

    function readCache(key) {
        try {
            var raw = localStorage.getItem(CACHE_PREFIX + key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function writeCache(key, data) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data: data }));
        } catch (e) { /* storage full: serve uncached */ }
    }

    function inBackoff(provider) {
        var until = Number(sessionStorage.getItem(CACHE_PREFIX + "backoff:" + provider) || 0);
        return until > Date.now();
    }

    function startBackoff(provider) {
        try { sessionStorage.setItem(CACHE_PREFIX + "backoff:" + provider, String(Date.now() + BACKOFF_MS)); } catch (e) { /* ignore */ }
    }

    function getJson(url, provider) {
        if (inflight[url]) return inflight[url];
        inflight[url] = fetch(url, { headers: { Accept: "application/json" } }).then(function(r) {
            if (r.status === 429) {
                startBackoff(provider);
                throw new Error("rate-limited");
            }
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).finally(function() { delete inflight[url]; });
        return inflight[url];
    }

    /* Returns { data, at, stale, error }. Serves fresh cache, otherwise fetches; on failure falls back to stale cache. */
    function cached(key, ttl, provider, url, force) {
        var hit = readCache(key);
        if (hit && !force && Date.now() - hit.at < ttl) return Promise.resolve({ data: hit.data, at: hit.at, stale: false });
        if (inBackoff(provider)) {
            return hit ? Promise.resolve({ data: hit.data, at: hit.at, stale: true, error: "rate-limited" })
                : Promise.reject(new Error("rate-limited"));
        }
        return getJson(url, provider).then(function(data) {
            if (data && data.ok === false) throw new Error(data.error || "unavailable");
            writeCache(key, data);
            return { data: data, at: Date.now(), stale: false };
        }).catch(function(err) {
            if (hit) return { data: hit.data, at: hit.at, stale: true, error: err.message };
            throw err;
        });
    }

    function emptyLive(asset) {
        return {
            price: null, change24h: null, marketCap: null, volumeUsd: null, volume: null, rank: null,
            high24h: null, low24h: null, sparkline: [], updatedAt: null, stale: false,
            status: asset.source === "none" ? "unavailable" : "loading",
            sourceLabel: asset.source === "coingecko" ? "CoinGecko" : asset.source === "yahoo" ? "Yahoo Finance" : null
        };
    }

    function loadCoinGecko(force) {
        var ids = ASSETS.filter(function(a) { return a.source === "coingecko"; }).map(function(a) { return a.coinId; });
        var url = COINGECKO + "/coins/markets?vs_currency=usd&ids=" + ids.join(",") +
            "&sparkline=true&price_change_percentage=24h&per_page=50";
        return cached("cg-markets", QUOTE_TTL, "coingecko", url, force);
    }

    function loadYahoo(force) {
        var symbols = ASSETS.filter(function(a) { return a.source === "yahoo"; }).map(function(a) { return a.yahoo; });
        var url = MARKET_API + "?type=quotes&symbols=" + encodeURIComponent(symbols.join(","));
        return cached("yahoo-quotes", QUOTE_TTL, "yahoo", url, force);
    }

    function loadGlobal(force) {
        return cached("cg-global", GLOBAL_TTL, "coingecko", COINGECKO + "/global", force);
    }

    /* Loads every asset. Resolves with { assets, global, errors } and never rejects. */
    function loadAll(force) {
        var live = {};
        ASSETS.forEach(function(a) { live[a.id] = emptyLive(a); });
        var errors = {};

        var cg = loadCoinGecko(force).then(function(res) {
            var byId = {};
            (res.data || []).forEach(function(row) { byId[row.id] = row; });
            ASSETS.forEach(function(a) {
                if (a.source !== "coingecko") return;
                var row = byId[a.coinId];
                var l = live[a.id];
                if (!row || row.current_price == null) { l.status = "unavailable"; return; }
                l.price = row.current_price;
                l.change24h = row.price_change_percentage_24h;
                l.marketCap = a.hideMarketCap ? null : row.market_cap;
                l.volumeUsd = row.total_volume;
                l.rank = a.category === "crypto" ? row.market_cap_rank : null;
                l.high24h = row.high_24h;
                l.low24h = row.low_24h;
                l.sparkline = row.sparkline_in_7d && row.sparkline_in_7d.price ? row.sparkline_in_7d.price : [];
                l.sparkLabel = "7D";
                l.updatedAt = row.last_updated ? Date.parse(row.last_updated) : res.at;
                l.stale = res.stale;
                l.status = res.stale ? "delayed" : "live";
            });
        }).catch(function(err) {
            errors.coingecko = err.message;
            ASSETS.forEach(function(a) { if (a.source === "coingecko") live[a.id].status = "unavailable"; });
        });

        var yh = loadYahoo(force).then(function(res) {
            var quotes = (res.data && res.data.quotes) || {};
            ASSETS.forEach(function(a) {
                if (a.source !== "yahoo") return;
                var q = quotes[a.yahoo];
                var l = live[a.id];
                if (!q || q.price == null) { l.status = "unavailable"; return; }
                l.price = q.price;
                l.change24h = q.changePercent24h;
                l.volume = q.volume;
                l.high24h = q.dayHigh;
                l.low24h = q.dayLow;
                l.fiftyTwoWeekHigh = q.fiftyTwoWeekHigh;
                l.fiftyTwoWeekLow = q.fiftyTwoWeekLow;
                l.exchange = q.exchange;
                l.sparkline = q.sparkline || [];
                l.sparkLabel = "5D";
                l.updatedAt = q.updatedAt || res.at;
                l.stale = res.stale;
                l.status = res.stale ? "delayed" : "live";
            });
        }).catch(function(err) {
            errors.yahoo = err.message;
            ASSETS.forEach(function(a) { if (a.source === "yahoo") live[a.id].status = "unavailable"; });
        });

        var global = null;
        var gl = loadGlobal(force).then(function(res) {
            var d = res.data && res.data.data;
            if (!d) return;
            global = {
                marketCap: d.total_market_cap && d.total_market_cap.usd,
                volume: d.total_volume && d.total_volume.usd,
                marketCapChange24h: d.market_cap_change_percentage_24h_usd,
                dominance: d.market_cap_percentage || {},
                updatedAt: d.updated_at ? d.updated_at * 1000 : res.at,
                stale: res.stale
            };
        }).catch(function(err) { errors.global = err.message; });

        return Promise.all([cg, yh, gl]).then(function() {
            return {
                assets: ASSETS.map(function(a) { return Object.assign({}, a, { live: live[a.id] }); }),
                global: global,
                errors: errors,
                loadedAt: Date.now()
            };
        });
    }

    function rangesFor(asset) {
        return RANGES[asset.source] || [];
    }

    /* Resolves with { points: [[ms, price]], at, stale } or rejects when no data is available. */
    function history(asset, range) {
        var ttl = range === "1h" || range === "24h" ? SHORT_HISTORY_TTL : HISTORY_TTL;
        if (asset.source === "coingecko") {
            var days = COINGECKO_DAYS[range];
            if (!days) return Promise.reject(new Error("unsupported range"));
            var url = COINGECKO + "/coins/" + asset.coinId + "/market_chart?vs_currency=usd&days=" + days;
            return cached("cg-hist:" + asset.coinId + ":" + days, ttl, "coingecko", url).then(function(res) {
                var points = (res.data && res.data.prices) || [];
                if (range === "1h" && points.length) {
                    var cutoff = points[points.length - 1][0] - 3600 * 1000;
                    points = points.filter(function(p) { return p[0] >= cutoff; });
                }
                return { points: points, at: res.at, stale: res.stale };
            });
        }
        if (asset.source === "yahoo") {
            var yurl = MARKET_API + "?type=history&symbol=" + encodeURIComponent(asset.yahoo) + "&range=" + range;
            return cached("yahoo-hist:" + asset.yahoo + ":" + range, ttl, "yahoo", yurl).then(function(res) {
                return { points: (res.data && res.data.points) || [], at: res.at, stale: res.stale };
            });
        }
        return Promise.reject(new Error("no data source"));
    }

    window.GVMarketData = {
        assets: ASSETS,
        categoryLabels: CATEGORY_LABELS,
        loadAll: loadAll,
        history: history,
        rangesFor: rangesFor,
        quoteTtl: QUOTE_TTL
    };
})();
