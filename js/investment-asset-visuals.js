(function(global) {
    "use strict";

    var VISUALS = {
        btc: { color: "#F7931A", label: "Bitcoin", symbol: "BTC", grad: ["#F7931A", "#E2760B"] },
        eth: { color: "#627EEA", label: "Ethereum", symbol: "ETH", grad: ["#627EEA", "#3C58D6"] },
        usdt: { color: "#26A17B", label: "Tether", symbol: "USDT", grad: ["#26A17B", "#1E8A68"] },
        bnb: { color: "#F3BA2F", label: "BNB", symbol: "BNB", grad: ["#F3BA2F", "#D4A017"] },
        xrp: { color: "#23292F", label: "XRP", symbol: "XRP", grad: ["#546C8C", "#23292F"] },
        sol: { color: "#9945FF", label: "Solana", symbol: "SOL", grad: ["#9945FF", "#14F195"] },
        gold: { color: "#FFD166", label: "Gold Investment", symbol: "XAU", grad: ["#FFD166", "#C9A227"], gold: true },
        oil: { color: "#1A1A1A", label: "Oil", symbol: "WTI", grad: ["#3D3D3D", "#0A0A0A"] },
        tsla: { color: "#E82127", label: "Tesla", symbol: "TSLA", grad: ["#E82127", "#B01016"] },
        aapl: { color: "#A2AAAD", label: "Apple", symbol: "AAPL", grad: ["#555", "#A2AAAD"] },
        googl: { color: "#4285F4", label: "Alphabet", symbol: "GOOGL", grad: ["#4285F4", "#34A853"] },
        msft: { color: "#00A4EF", label: "Microsoft", symbol: "MSFT", grad: ["#00A4EF", "#0078D4"] },
        nvda: { color: "#76B900", label: "NVIDIA", symbol: "NVDA", grad: ["#76B900", "#5A8F00"] },
        spy: { color: "#00E89B", label: "SPDR S&P 500", symbol: "SPY", grad: ["#00E89B", "#008F66"] },
        qqq: { color: "#8BFFD0", label: "Invesco QQQ", symbol: "QQQ", grad: ["#8BFFD0", "#00E89B"] },
        vti: { color: "#6B8F84", label: "Vanguard Total Market", symbol: "VTI", grad: ["#6B8F84", "#3E574F"] },
        diamond: { color: "#5CE1FF", label: "Diamond", symbol: "DIAMOND", grad: ["#5CE1FF", "#0099CC"], diamond: true }
    };

    function meta(assetId, fallbackName, fallbackSymbol) {
        var id = String(assetId || "").toLowerCase();
        var v = VISUALS[id];
        if (v) return Object.assign({ id: id }, v);
        return {
            id: id,
            color: "#00E89B",
            label: fallbackName || id,
            symbol: fallbackSymbol || id.toUpperCase(),
            grad: ["#00E89B", "#008F66"]
        };
    }

    function iconHtml(assetId, size, fallbackName, fallbackSymbol) {
        size = size || 40;
        var m = meta(assetId, fallbackName, fallbackSymbol);
        var r = Math.round(size * 0.22);
        var font = Math.max(10, Math.round(size * 0.28));
        var sym = (m.symbol || "A").slice(0, 4);
        if (m.gold) {
            return '<span class="inv-asset-icon inv-asset-icon-gold" style="width:' + size + "px;height:" + size + 'px" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '"><rect x="4" y="10" width="6" height="8" rx="1" fill="#FFD166"/><rect x="10" y="8" width="6" height="10" rx="1" fill="#FFC940"/><rect x="16" y="11" width="4" height="7" rx="1" fill="#FFE08A"/></svg></span>';
        }
        if (m.diamond) {
            return '<span class="inv-asset-icon inv-asset-icon-diamond" style="width:' + size + "px;height:" + size + 'px" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '"><path d="M12 2l8 8-8 12L4 10z" fill="url(#d' + assetId + ')"/><defs><linearGradient id="d' + assetId + '" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5CE1FF"/><stop offset="1" stop-color="#0099CC"/></linearGradient></defs></svg></span>';
        }
        if (m.id === "oil") {
            return '<span class="inv-asset-icon" style="width:' + size + "px;height:" + size + 'px" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '"><path d="M12 2s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z" fill="#2A2A2A" stroke="#666" stroke-width="1"/></svg></span>';
        }
        return '<span class="inv-asset-icon" style="width:' + size + "px;height:" + size + "px;background:linear-gradient(135deg," + m.grad[0] + "," + m.grad[1] + ');border-radius:' + r + 'px;font-size:' + font + 'px" aria-hidden="true">' +
            sym.replace(/[^A-Z0-9]/gi, "").slice(0, 3) + "</span>";
    }

    global.InvestmentAssetVisuals = { meta: meta, iconHtml: iconHtml, VISUALS: VISUALS };
})(typeof window !== "undefined" ? window : global);
