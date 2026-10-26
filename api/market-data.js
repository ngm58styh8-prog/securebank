/* Server-side market quotes for instruments whose provider (Yahoo Finance) blocks browser CORS requests.
   Only whitelisted symbols are accepted so this cannot be used as an open proxy. */

const ALLOWED_SYMBOLS = new Set(["TSLA", "AAPL", "GOOGL", "MSFT", "NVDA", "SPY", "QQQ", "VTI", "CL=F"]);

const HISTORY_RANGES = {
    "1h": { range: "1d", interval: "1m", lastMs: 60 * 60 * 1000 },
    "24h": { range: "1d", interval: "5m" },
    "7d": { range: "5d", interval: "15m" },
    "30d": { range: "1mo", interval: "60m" },
    "1y": { range: "1y", interval: "1d" },
    "all": { range: "max", interval: "1mo" }
};

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

async function fetchChart(symbol, range, interval) {
    const url = YAHOO_BASE + encodeURIComponent(symbol) + "?range=" + range + "&interval=" + interval;
    const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (GlobalVest market data)", "Accept": "application/json" }
    });
    if (response.status === 429) {
        const err = new Error("Market data provider rate limit reached");
        err.status = 429;
        throw err;
    }
    if (!response.ok) throw new Error("Provider responded " + response.status);
    const data = await response.json();
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result || !result.meta) throw new Error("No data for " + symbol);
    return result;
}

function seriesFrom(result) {
    const times = result.timestamp || [];
    const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    const closes = quote.close || [];
    const points = [];
    for (let i = 0; i < times.length; i++) {
        if (closes[i] != null && isFinite(closes[i])) points.push([times[i] * 1000, closes[i]]);
    }
    return points;
}

async function quoteFor(symbol) {
    const result = await fetchChart(symbol, "5d", "60m");
    const m = result.meta;
    const price = m.regularMarketPrice;
    const prev = m.previousClose;
    let change = m.regularMarketChangePercent;
    if (change == null && prev) change = ((price - prev) / prev) * 100;
    return {
        symbol: symbol,
        name: m.longName || m.shortName || symbol,
        currency: m.currency || "USD",
        exchange: m.fullExchangeName || m.exchangeName || null,
        instrumentType: m.instrumentType || null,
        price: price,
        previousClose: prev != null ? prev : null,
        changePercent24h: change != null ? change : null,
        volume: m.regularMarketVolume != null ? m.regularMarketVolume : null,
        dayHigh: m.regularMarketDayHigh != null ? m.regularMarketDayHigh : null,
        dayLow: m.regularMarketDayLow != null ? m.regularMarketDayLow : null,
        fiftyTwoWeekHigh: m.fiftyTwoWeekHigh != null ? m.fiftyTwoWeekHigh : null,
        fiftyTwoWeekLow: m.fiftyTwoWeekLow != null ? m.fiftyTwoWeekLow : null,
        updatedAt: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
        sparkline: seriesFrom(result).map(function(p) { return p[1]; })
    };
}

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    const query = req.query || {};
    const type = String(query.type || "quotes");

    try {
        if (type === "quotes") {
            const symbols = String(query.symbols || "").split(",")
                .map(function(s) { return s.trim().toUpperCase(); })
                .filter(function(s) { return ALLOWED_SYMBOLS.has(s); });
            if (!symbols.length) {
                res.status(400).json({ ok: false, error: "No supported symbols requested" });
                return;
            }
            const settled = await Promise.allSettled(symbols.map(quoteFor));
            const quotes = {};
            const errors = {};
            settled.forEach(function(r, i) {
                if (r.status === "fulfilled") quotes[symbols[i]] = r.value;
                else errors[symbols[i]] = r.reason && r.reason.message ? r.reason.message : "Unavailable";
            });
            res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
            res.status(200).json({ ok: true, source: "Yahoo Finance", fetchedAt: Date.now(), quotes: quotes, errors: errors });
            return;
        }

        if (type === "history") {
            const symbol = String(query.symbol || "").toUpperCase();
            const rangeKey = String(query.range || "24h").toLowerCase();
            const spec = HISTORY_RANGES[rangeKey];
            if (!ALLOWED_SYMBOLS.has(symbol) || !spec) {
                res.status(400).json({ ok: false, error: "Unsupported symbol or range" });
                return;
            }
            const result = await fetchChart(symbol, spec.range, spec.interval);
            let points = seriesFrom(result);
            if (spec.lastMs && points.length) {
                const cutoff = points[points.length - 1][0] - spec.lastMs;
                points = points.filter(function(p) { return p[0] >= cutoff; });
            }
            res.setHeader("Cache-Control", "public, s-maxage=" + (rangeKey === "1h" ? 60 : 300) + ", stale-while-revalidate=600");
            res.status(200).json({ ok: true, source: "Yahoo Finance", symbol: symbol, range: rangeKey, fetchedAt: Date.now(), points: points });
            return;
        }

        res.status(400).json({ ok: false, error: "Unknown type" });
    } catch (err) {
        const status = err && err.status === 429 ? 429 : 502;
        res.status(status).json({ ok: false, error: err && err.message ? err.message : "Market data unavailable" });
    }
};
