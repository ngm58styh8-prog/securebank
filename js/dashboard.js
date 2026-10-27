const PAGE_START = Date.now();
const username = requireAuth();
if (!username) {
    /* requireAuth redirects to login; stop before touching account data */
    throw new Error("Not authenticated");
}

const account = getAccount(username);
ensureProfile(username, account);
ensureSettings(username, account);
ensureHoldings(account);
ensureGoldInvestment(account);
syncAccountNotifications(username, account);
const settings = getSettings(account);
let prices = {};
let changes = {};
let lineChart = null;
let pieChart = null;

const COINS = [
    { key: "btc", label: "BTC", symbol: "₿", marketId: "BTC", apiKey: "bitcoin", category: "crypto", tradeQty: 0.01 },
    { key: "eth", label: "ETH", symbol: "Ξ", marketId: "ETH", apiKey: "ethereum", category: "crypto", tradeQty: 0.10 },
    { key: "sol", label: "SOL", symbol: "◎", marketId: "SOL", apiKey: "solana", category: "crypto", tradeQty: 0.5 },
    { key: "xrp", label: "XRP", symbol: "X", marketId: "XRP", apiKey: "ripple", category: "crypto", tradeQty: 50 }
];

const GOLD = [
    { key: "gold", label: "GOLD", symbol: "🥇", marketId: "GOLD", apiKey: "pax-gold", category: "gold", tradeQty: 0.1, unit: "oz" }
];

const STOCKS = [
    { key: "aapl", label: "AAPL", symbol: "🍎", marketId: "AAPL", yahooSymbol: "AAPL", category: "stock", tradeQty: 1, unit: "shares", basePrice: 228.5, baseChange: 1.2 },
    { key: "googl", label: "GOOGL", symbol: "🔍", marketId: "GOOGL", yahooSymbol: "GOOGL", category: "stock", tradeQty: 1, unit: "shares", basePrice: 175.8, baseChange: -0.4 },
    { key: "msft", label: "MSFT", symbol: "💻", marketId: "MSFT", yahooSymbol: "MSFT", category: "stock", tradeQty: 1, unit: "shares", basePrice: 420.3, baseChange: 0.8 },
    { key: "nvda", label: "NVDA", symbol: "🟢", marketId: "NVDA", yahooSymbol: "NVDA", category: "stock", tradeQty: 1, unit: "shares", basePrice: 135.6, baseChange: 2.1 }
];

const INVESTMENTS = [
    { key: "spy", label: "SPY", symbol: "📊", marketId: "SPY", yahooSymbol: "SPY", category: "investment", tradeQty: 1, unit: "shares", basePrice: 580.2, baseChange: 0.5 },
    { key: "qqq", label: "QQQ", symbol: "📈", marketId: "QQQ", yahooSymbol: "QQQ", category: "investment", tradeQty: 1, unit: "shares", basePrice: 510.4, baseChange: 0.7 },
    { key: "vti", label: "VTI", symbol: "🌐", marketId: "VTI", yahooSymbol: "VTI", category: "investment", tradeQty: 1, unit: "shares", basePrice: 290.1, baseChange: 0.4 }
];

const ALL_ASSETS = COINS.concat(GOLD, STOCKS, INVESTMENTS);

ALL_ASSETS.forEach(function(a) {
    prices[a.key] = 0;
    changes[a.key] = 0;
});

function saveState(options) {
    options = options || {};
    if (typeof syncAccountNotifications === "function") {
        syncAccountNotifications(username, account);
    }
    const syncOptions = Object.assign({ skipServerSync: true }, options);
    saveAccount(username, account, syncOptions);
}

function saveStateAndSync(eventType) {
    saveAccount(username, account, {
        eventType: eventType || "signup",
        skipServerSync: false
    });
}

function getAsset(key) {
    return ALL_ASSETS.find(function(a) { return a.key === key; });
}

function formatPrice(price) {
    return formatMoney(price, settings.currency);
}

function formatQuantity(asset, quantity) {
    if (asset.category === "crypto") {
        if (asset.label === "BTC") return quantity.toFixed(4);
        if (asset.label === "XRP") return quantity.toFixed(0);
        return quantity.toFixed(2);
    }
    if (asset.category === "gold") return quantity.toFixed(2) + " oz";
    return Math.round(quantity) + " " + (asset.unit || "shares");
}

function formatHoldingsDisplay(asset, qty) {
    if (asset.category === "gold") return qty.toFixed(2) + " oz";
    if (asset.key === "xrp") return qty.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " XRP";
    if (asset.key === "btc") return qty.toFixed(4) + " BTC";
    if (asset.category === "crypto") return qty.toFixed(2) + " " + asset.label;
    return Math.round(qty) + " shares";
}

function formatChange(change) {
    const arrow = change >= 0 ? "▲" : "▼";
    const className = change >= 0 ? "change-up" : "change-down";
    return `<span class="${className}">${arrow} ${Math.abs(change).toFixed(2)}%</span>`;
}

function getHoldings(key) {
    return account.holdings[key] || 0;
}

function setHoldings(key, value) {
    account.holdings[key] = value;
}

function assetValue(key) {
    return getHoldings(key) * (prices[key] || 0);
}

function portfolioValue() {
    let total = account.cash;
    ALL_ASSETS.forEach(function(a) {
        total += assetValue(a.key);
    });
    if (typeof getGoldInvestmentBalance === "function") {
        total += getGoldInvestmentBalance(account);
    }
    return total;
}

function cryptoPortfolioValue() {
    return COINS.reduce(function(sum, a) {
        return sum + assetValue(a.key);
    }, 0);
}

function categoryValue(category) {
    return ALL_ASSETS
        .filter(function(a) { return a.category === category; })
        .reduce(function(sum, a) { return sum + assetValue(a.key); }, 0);
}

function ensureBaseline() {
    if (account.baselineValue !== null) return;
    /* Never record a baseline before live prices are known, or later market data would look like profit. */
    if (!pricesReadyForHoldings()) return;
    account.baselineValue = portfolioValue() || account.cash;
    saveState();
}

function addNotification(message, options) {
    options = options || {};
    if (typeof pushAccountNotification === "function") {
        pushAccountNotification(account, message, options);
    } else {
        ensureNotifications(account);
        account.notifications.unshift({
            id: Date.now() + Math.random(),
            message: message,
            time: new Date().toISOString(),
            read: false,
            type: options.type || null,
            status: options.status || "completed",
            amount: options.amount != null ? options.amount : null,
            currency: options.currency || null
        });
        if (account.notifications.length > 30) {
            account.notifications = account.notifications.slice(0, 30);
        }
    }
    saveState();
    if (typeof renderNotificationBell === "function") {
        renderNotificationBell(account);
    }
}

function formatTradeNotification(asset, type, qty, price) {
    const qtyLabel = formatQuantity(asset, qty);
    const total = formatPrice(price * qty);
    if (type === "buy") {
        return "Bought " + qtyLabel + " " + asset.label + " for " + total;
    }
    return "Sold " + qtyLabel + " " + asset.label + " for " + total;
}

function renderNotifications() {
    if (typeof renderNotificationBell === "function") {
        renderNotificationBell(account);
    }
}

function refreshNotificationsFromStorage() {
    syncAccountNotifications(username, account);
    renderNotifications();
}

function markNotificationsRead() {
    if (typeof markAllNotificationsReadForUser === "function") {
        markAllNotificationsReadForUser(username);
        return;
    }
    account.notifications.forEach(function(n) { n.read = true; });
    saveState();
    renderNotifications();
}

function renderTransactions() {
    const tbody = document.getElementById("transactionBody");
    const recent = account.transactions.slice(0, 5);
    if (tbody) {
        tbody.innerHTML = recent.map(function(t) {
            const sign = t.amount < 0 ? "-" : "+";
            return `<tr>
            <td>${t.date}</td>
            <td>${t.description}</td>
            <td>${sign}${formatMoney(Math.abs(t.amount), settings.currency)}</td>
        </tr>`;
        }).join("");
    }
    syncFintechDashboard();
}

function pricesReadyForHoldings() {
    return ALL_ASSETS.every(function(a) {
        return !(getHoldings(a.key) > 0) || prices[a.key] > 0;
    });
}

function syncFintechDashboard() {
    if (typeof window.updateFintechDashboard !== "function") return;
    window.updateFintechDashboard({
        username: username,
        account: account,
        settings: settings,
        prices: prices,
        changes: changes,
        pricesReady: pricesReadyForHoldings(),
        formatPrice: formatPrice,
        portfolioValue: portfolioValue,
        assetValue: assetValue,
        ALL_ASSETS: ALL_ASSETS,
        pendingTransfers: typeof getUserPendingTransfers === "function" ? getUserPendingTransfers(username) : [],
        pendingDeposits: typeof getUserPendingDeposits === "function" ? getUserPendingDeposits(username) : [],
        setPortfolioSeries: function(labels, values) {
            if (!lineChart) return;
            lineChart.data.labels = labels;
            lineChart.data.datasets[0].data = values;
            lineChart.update();
        },
        pendingTotal: typeof getUserPendingTransferTotal === "function" ? getUserPendingTransferTotal(username) : 0,
        getGoldInvestmentBalance: typeof getGoldInvestmentBalance === "function"
            ? getGoldInvestmentBalance
            : function() { return 0; }
    });
}

function addTransaction(description, amount, options) {
    options = options || {};
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: description,
        amount: amount
    });
    if (options.notify !== false) {
        const type = options.type ||
            (typeof classifyLedgerType === "function" ? classifyLedgerType(description) : "general");
        addNotification(options.message || description, {
            type: type,
            title: options.title || (typeof ledgerTypeTitle === "function" ? ledgerTypeTitle(type) : null),
            amount: amount != null ? Math.abs(Number(amount)) : null,
            currency: options.currency || "USD",
            status: options.status || (/pending/i.test(description) ? "pending" : "completed")
        });
        renderTransactions();
        return;
    }
    saveState();
    renderTransactions();
}

function updatePL() {
    ensureBaseline();
    const current = portfolioValue();
    const plEl = document.getElementById("plValue");
    const pctEl = document.getElementById("plPercent");
    if (!plEl || !pctEl) return;
    if (account.baselineValue === null || account.baselineValue === undefined) {
        plEl.textContent = "—";
        plEl.className = "balance";
        pctEl.textContent = "Waiting for live prices";
        pctEl.className = "pl-sub";
        return;
    }
    const pl = current - account.baselineValue;
    const pct = account.baselineValue ? (pl / account.baselineValue) * 100 : 0;

    plEl.textContent = (pl >= 0 ? "+" : "") + formatPrice(pl);
    plEl.className = "balance " + (pl >= 0 ? "pl-positive" : "pl-negative");
    pctEl.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "% all time";
    pctEl.className = "pl-sub " + (pct >= 0 ? "pl-positive" : "pl-negative");
}

function updateCharts() {
    if (!pieChart) return;

    pieChart.data.datasets[0].data = [
        account.cash,
        categoryValue("crypto"),
        categoryValue("gold"),
        categoryValue("stock"),
        categoryValue("investment")
    ];
    pieChart.update();
}

function updateAnalytics() {
    const analytics = ensureAnalytics(account);
    const total = portfolioValue();
    const today = new Date().toDateString();
    const month = new Date().getFullYear() + "-" + (new Date().getMonth() + 1);

    /* Baselines are only captured once live prices are known; otherwise holdings count as $0
       and the later price load would be reported as a fake gain. */
    const pricesReady = pricesReadyForHoldings();
    if (pricesReady) {
        if (analytics.dayStartDate !== today) {
            analytics.dayStartValue = total;
            analytics.dayStartDate = today;
        }
        if (analytics.monthStartMonth !== month) {
            analytics.monthStartValue = total;
            analytics.monthStartMonth = month;
        }
        saveState();
    }
    const hasDayBaseline = analytics.dayStartDate === today && analytics.dayStartValue != null;

    const todayProfit = hasDayBaseline ? total - (analytics.dayStartValue || total) : 0;
    const monthProfit = total - (analytics.monthStartValue || total);
    const monthPct = analytics.monthStartValue ? (monthProfit / analytics.monthStartValue) * 100 : 0;

    const totalAssetsEl = document.getElementById("totalAssets");
    if (totalAssetsEl) totalAssetsEl.textContent = formatPrice(total);

    const todayEl = document.getElementById("todayProfit");
    if (todayEl) {
        todayEl.textContent = (todayProfit >= 0 ? "+" : "") + formatPrice(todayProfit);
        todayEl.className = "balance " + (todayProfit >= 0 ? "pl-positive" : "pl-negative");
    }

    const dayPct = hasDayBaseline && analytics.dayStartValue ? (todayProfit / analytics.dayStartValue) * 100 : 0;
    const heroVal = document.getElementById("heroPortfolioValue");
    const heroGain = document.getElementById("heroTodayGain");
    if (heroVal) {
        if (!pricesReady && (Date.now() - PAGE_START) < 8000) {
            heroVal.removeAttribute("data-balance-value");
            heroVal.textContent = "Loading…";
        } else if (typeof window.animateHeroPortfolio === "function") {
            window.animateHeroPortfolio(total, formatPrice(total));
        } else {
            heroVal.textContent = formatPrice(total);
        }
    }
    if (heroGain) {
        const arrow = todayProfit >= 0 ? "▲" : "▼";
        const gainText = arrow + " " + (todayProfit >= 0 ? "+" : "") + formatPrice(todayProfit) +
            " (" + (dayPct >= 0 ? "+" : "") + dayPct.toFixed(2) + "%)";
        const shownGain = hasDayBaseline ? gainText : "Today's change unavailable";
        heroGain.setAttribute("data-gain-value", shownGain);
        heroGain.textContent = document.body.classList.contains("balances-hidden")
            ? "Today's change hidden" : shownGain;
        heroGain.className = "gv-hero-gain " + (!hasDayBaseline ? "" : (todayProfit >= 0 ? "pl-positive" : "pl-negative"));
    }

    const monthEl = document.getElementById("monthlyReturn");
    if (monthEl) {
        monthEl.textContent = (monthPct >= 0 ? "+" : "") + monthPct.toFixed(2) + "%";
        monthEl.className = "balance " + (monthPct >= 0 ? "pl-positive" : "pl-negative");
    }

    let best = { label: "—", change: -Infinity };
    let worst = { label: "—", change: Infinity };
    ALL_ASSETS.forEach(function(asset) {
        const ch = changes[asset.key] || 0;
        if (!prices[asset.key]) return;
        if (ch > best.change) best = { label: asset.label, change: ch };
        if (ch < worst.change) worst = { label: asset.label, change: ch };
    });

    const bestEl = document.getElementById("bestCoin");
    const worstEl = document.getElementById("worstCoin");
    if (bestEl) {
        bestEl.innerHTML = best.label !== "—"
            ? `${best.label} ${formatChange(best.change)}` : "—";
    }
    if (worstEl) {
        worstEl.innerHTML = worst.label !== "—"
            ? `${worst.label} ${formatChange(worst.change)}` : "—";
    }
}

function renderAssetCard(asset) {
    const h = getHoldings(asset.key);
    const holdingsEl = document.getElementById(asset.key + "Holdings");
    const priceEl = document.getElementById(asset.key + "Price");
    const changeEl = document.getElementById(asset.key + "Change");

    if (!holdingsEl) return;

    holdingsEl.textContent = formatHoldingsDisplay(asset, h);
    if (priceEl) {
        priceEl.innerHTML = prices[asset.key]
            ? `<span class="live-dot"></span>${asset.symbol} ${formatPrice(prices[asset.key])}`
            : "Loading...";
    }
    if (changeEl) {
        changeEl.innerHTML = prices[asset.key] ? formatChange(changes[asset.key]) : "—";
    }

    document.querySelectorAll('[data-asset="' + asset.key + '"], [data-coin="' + asset.key + '"]').forEach(function(btn) {
        btn.disabled = !(prices[asset.key] > 0);
    });
}

function updateMarketRow(asset) {
    const priceEl = document.getElementById("market" + asset.marketId);
    const changeEl = document.getElementById("market" + asset.marketId + "Change");
    if (!priceEl || !prices[asset.key]) return;
    priceEl.textContent = formatPrice(prices[asset.key]);
    changeEl.innerHTML = formatChange(changes[asset.key]);
}

function renderVerificationBanner() {
    const banner = document.getElementById("verificationBanner");
    if (!banner || !account.profile) return;

    const needsVerification = account.profile.verificationStatus !== "Verified" ||
        !account.profile.ssnLast4;
    banner.classList.toggle("hidden", !needsVerification);
}

function reloadAccountFromRegistry() {
    const fresh = typeof getRegistryAccount === "function"
        ? getRegistryAccount(username)
        : getAccount(username);
    if (!fresh) return;
    account.cash = fresh.cash;
    account.serverSyncedAt = fresh.serverSyncedAt;
    account.transactions = fresh.transactions || account.transactions;
    account.notifications = fresh.notifications || account.notifications;
    account.holdings = fresh.holdings || account.holdings;
    account.goldInvestment = fresh.goldInvestment || account.goldInvestment;
    account.pendingDeposits = fresh.pendingDeposits || account.pendingDeposits;
    ensureProfile(username, account);
    ensureSettings(username, account);
    ensureHoldings(account);
    ensureGoldInvestment(account);
    syncAccountNotifications(username, account);
    updateUI();
}

function updateUI() {
    const pendingTotal = getUserPendingTransferTotal(username);
    const available = account.cash - pendingTotal;

    const accountBalanceEl = document.getElementById("accountBalance");
    if (accountBalanceEl) {
        accountBalanceEl.textContent = formatPrice(account.cash);
        if (pendingTotal > 0) {
            accountBalanceEl.title = "Available: " + formatPrice(available) + " (" + formatPrice(pendingTotal) + " pending approval)";
        }
    }

    const displayName = account.profile ? account.profile.fullName : username;
    const userNameEl = document.getElementById("userName");
    const profileNameEl = document.getElementById("profileName");
    if (userNameEl) userNameEl.textContent = displayName;
    if (profileNameEl) profileNameEl.textContent = displayName;

    ALL_ASSETS.forEach(renderAssetCard);
    ALL_ASSETS.forEach(updateMarketRow);

    updatePL();
    updateCharts();
    updateAnalytics();
    refreshNotificationsFromStorage();
    renderVerificationBanner();
    syncFintechDashboard();
}

function checkPriceAlerts() {
    if (!account.lastAlerts || typeof account.lastAlerts !== "object") account.lastAlerts = {};
    ALL_ASSETS.forEach(function(asset) {
        const change = changes[asset.key];
        if (change == null || !prices[asset.key]) return;

        const prev = account.lastAlerts[asset.key];
        const sign = change >= 0 ? "+" : "";

        if (Math.abs(change) >= 2 && (!prev || Math.abs(change - prev) >= 0.5)) {
            addNotification(asset.label + " price " + sign + change.toFixed(1) + "% today", { type: "market" });
            account.lastAlerts[asset.key] = change;
        }
    });
    saveState();
}

async function loadCryptoAndGold() {
    try {
        const response = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple,pax-gold&vs_currencies=usd&include_24hr_change=true"
        );
        if (!response.ok) return;

        const data = await response.json();

        COINS.forEach(function(coin) {
            const coinData = data[coin.apiKey];
            if (!coinData) return;
            prices[coin.key] = coinData.usd;
            changes[coin.key] = coinData.usd_24h_change || 0;
        });

        const goldData = data["pax-gold"];
        if (goldData) {
            prices.gold = goldData.usd;
            changes.gold = goldData.usd_24h_change || 0;
        }
    } catch (err) {
        console.log(err);
    }
}

function simulateEquityPrice(asset) {
    const drift = 1 + (Math.random() - 0.5) * 0.008;
    prices[asset.key] = asset.basePrice * drift;
    changes[asset.key] = asset.baseChange + (Math.random() - 0.5) * 0.3;
}

async function loadEquityQuote(asset) {
    try {
        const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
            asset.yahooSymbol + "?interval=1d&range=1d";
        const response = await fetch(url);
        if (!response.ok) throw new Error("Quote unavailable");

        const data = await response.json();
        const meta = data.chart.result[0].meta;
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose;

        prices[asset.key] = price;
        changes[asset.key] = prev ? ((price - prev) / prev) * 100 : 0;
    } catch (err) {
        simulateEquityPrice(asset);
    }
}

async function loadEquityPrices() {
    const equities = STOCKS.concat(INVESTMENTS);
    await Promise.all(equities.map(loadEquityQuote));
}

async function loadMarketPrices() {
    await loadCryptoAndGold();
    await loadEquityPrices();
    checkPriceAlerts();
    updateUI();
}

function tradeAsset(assetKey, type) {
    const asset = getAsset(assetKey);
    if (!asset) return;

    const price = prices[assetKey];
    const qty = asset.tradeQty;
    if (!price) return;

    if (type === "buy") {
        const cost = price * qty;
        if (account.cash < cost) {
            addNotification("Buy failed — insufficient cash for " + asset.label, { type: "trade" });
            return;
        }
        account.cash -= cost;
        setHoldings(assetKey, getHoldings(assetKey) + qty);
        addNotification(formatTradeNotification(asset, "buy", qty, price), {
            type: "trade",
            title: "Trade",
            amount: cost,
            currency: "USD"
        });
        addTransaction("Buy " + formatQuantity(asset, qty), -cost, { notify: false });
    } else {
        if (getHoldings(assetKey) < qty) {
            addNotification("Sell failed — insufficient " + asset.label + " holdings", { type: "trade" });
            return;
        }
        const proceeds = price * qty;
        setHoldings(assetKey, getHoldings(assetKey) - qty);
        account.cash += proceeds;
        addTransaction("Sell " + formatQuantity(asset, qty), proceeds, { notify: false });
        addNotification(formatTradeNotification(asset, "sell", qty, price), {
            type: "trade",
            title: "Trade",
            amount: proceeds,
            currency: "USD"
        });
    }

    saveStateAndSync("trade");
    updateUI();
}

function buyAsset(key) { tradeAsset(key, "buy"); }
function sellAsset(key) { tradeAsset(key, "sell"); }

function buyBTC() { buyAsset("btc"); }
function sellBTC() { sellAsset("btc"); }
function buyETH() { buyAsset("eth"); }
function sellETH() { sellAsset("eth"); }
function buySOL() { buyAsset("sol"); }
function sellSOL() { sellAsset("sol"); }
function buyXRP() { buyAsset("xrp"); }
function sellXRP() { sellAsset("xrp"); }

function getAdminBtcAddress() {
    return getAdminWalletAddress();
}

function getDepositCryptoConfig() {
    return typeof CryptoDepositConfig !== "undefined" ? CryptoDepositConfig : null;
}

function getSelectedDepositCurrency() {
    const select = document.getElementById("depositCryptoSelect");
    const sym = select && select.value ? select.value : "BTC";
    return sym.trim().toUpperCase();
}

function getSelectedDepositWallet() {
    const cfg = getDepositCryptoConfig();
    const symbol = getSelectedDepositCurrency();
    if (cfg && typeof getAdminCryptoDepositWallets === "function") {
        const wallets = getAdminCryptoDepositWallets();
        return cfg.getWalletBySymbol(wallets, symbol);
    }
    if (cfg) {
        return cfg.getWalletBySymbol(getAdminData(), symbol);
    }
    return { symbol: "BTC", name: "Bitcoin", address: getAdminWalletAddress() };
}

function populateDepositCryptoSelect() {
    const select = document.getElementById("depositCryptoSelect");
    if (!select) return;

    const cfg = getDepositCryptoConfig();
    const wallets = typeof getAdminCryptoDepositWallets === "function"
        ? getAdminCryptoDepositWallets()
        : (cfg ? cfg.DEFAULT_CRYPTO_DEPOSIT_WALLETS : []);
    const current = getSelectedDepositCurrency();

    select.innerHTML = wallets.map(function(w) {
        const sym = w.symbol;
        const label = cfg
            ? cfg.formatDepositCurrencyLabel(sym, w.name)
            : w.name + " (" + sym + ")";
        const selected = sym === current ? " selected" : "";
        return "<option value=\"" + sym + "\"" + selected + ">" + label + "</option>";
    }).join("");
}

function updateDepositQrCode(address) {
    const qr = document.getElementById("depositQrImage");
    if (!qr) return;

    if (!address) {
        qr.classList.add("hidden");
        qr.removeAttribute("src");
        return;
    }

    qr.src = "https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=" +
        encodeURIComponent(address);
    qr.classList.remove("hidden");
}

function updateDepositCryptoDisplay() {
    const wallet = getSelectedDepositWallet();
    const cfg = getDepositCryptoConfig();
    const labelEl = document.getElementById("depositCryptoPayLabel");
    const addressEl = document.getElementById("depositPageAddress");
    const cryptoNameEl = document.getElementById("depositPageCryptoName");

    if (labelEl && wallet) {
        labelEl.textContent = cfg
            ? cfg.getDepositSendLabel(wallet.symbol, wallet.name)
            : "Send " + wallet.name + " (" + wallet.symbol + ") to:";
    }

    if (addressEl) {
        addressEl.textContent = wallet && wallet.address
            ? wallet.address
            : "Deposit address not configured — contact support.";
    }

    if (cryptoNameEl && wallet) {
        cryptoNameEl.textContent = wallet.symbol;
    }

    updateDepositConfirmInstruction();
    updateDepositQrCode(wallet && wallet.address ? wallet.address : "");

    const networkEl = document.getElementById("depositNetworkLabel");
    const minEl = document.getElementById("depositMinLabel");
    const confEl = document.getElementById("depositConfirmationsLabel");
    if (wallet) {
        if (networkEl) {
            networkEl.textContent = "Network: " + (wallet.network || (wallet.symbol === "ETH" ? "Ethereum Mainnet" : "Bitcoin Mainnet"));
        }
        if (minEl) {
            const minUsd = wallet.minDepositUsd != null ? wallet.minDepositUsd : 50;
            minEl.textContent = "Minimum deposit: $" + Number(minUsd).toFixed(2) + " USD equivalent";
        }
        if (confEl) {
            const conf = wallet.confirmationsRequired != null ? wallet.confirmationsRequired : (wallet.symbol === "ETH" ? 12 : 3);
            confEl.textContent = "Network confirmations required: " + conf;
        }
    }

    return wallet && wallet.address ? wallet.address : "";
}

function copyText(text, successMessage) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            alert(successMessage || "Copied to clipboard.");
        });
    } else {
        alert(text);
    }
}

function getDepositBtcAmount(usdAmount) {
    return getDepositCryptoAmount(usdAmount, "BTC");
}

function getDepositCryptoAmount(usdAmount, symbol) {
    const cfg = getDepositCryptoConfig();
    if (cfg) {
        return cfg.getCryptoAmountForUsd(usdAmount, symbol, prices);
    }
    if (!usdAmount || usdAmount <= 0) return null;
    const sym = String(symbol || "BTC").toUpperCase();
    if (sym === "BTC") {
        if (!prices.btc) return null;
        return usdAmount / prices.btc;
    }
    if (sym === "ETH") {
        if (!prices.eth) return null;
        return usdAmount / prices.eth;
    }
    return null;
}

function formatBtcAmount(btc) {
    return formatDepositCryptoAmount(btc, "BTC");
}

function formatDepositCryptoAmount(amount, symbol) {
    const cfg = getDepositCryptoConfig();
    if (cfg) return cfg.formatCryptoAmount(amount, symbol);
    if (!amount || amount <= 0) return "—";
    const sym = String(symbol || "BTC").toUpperCase();
    if (sym === "BTC") return amount.toFixed(8) + " BTC";
    if (sym === "ETH") return amount.toFixed(6) + " ETH";
    return amount.toFixed(6) + " " + sym;
}

function getDepositConfirmInstruction(symbol) {
    const sym = String(symbol || "BTC").toUpperCase();
    return "Send the exact " + sym + " amount above to the deposit address. " +
        "Once you've completed the transfer, click 'Submit Deposit' to notify us of your payment.";
}

function buildDepositSuccessAlert(amount, symbol, cryptoAmount, walletAddress, emailSent) {
    const cryptoDisplay = cryptoAmount
        ? formatDepositCryptoAmount(cryptoAmount, symbol)
        : "—";
    const emailLine = emailSent === false
        ? "We could not send a confirmation email right now — check in-app notifications or contact support."
        : "A confirmation email has been sent to your registered email address.";

    return "Deposit Request Received\n\n" +
        "Your deposit request has been received successfully.\n\n" +
        "Deposit Details\n\n" +
        "• USD Amount: $" + amount.toFixed(2) + "\n" +
        "• Cryptocurrency: " + symbol + "\n" +
        "• Amount to Send: " + cryptoDisplay + "\n" +
        "• Deposit Address:\n" + walletAddress + "\n\n" +
        "Please send the exact " + symbol + " amount shown above to the wallet address provided.\n\n" +
        "Your deposit will be credited to your account after the transaction has been received and confirmed on the blockchain.\n\n" +
        emailLine + "\n\n" +
        "Thank you for banking with us.";
}

function updateDepositConfirmInstruction() {
    const el = document.getElementById("depositConfirmInstruction");
    if (!el) return;
    el.textContent = getDepositConfirmInstruction(getSelectedDepositCurrency());
}

function getDepositAmountValue() {
    const input = document.getElementById("depositAmountInput");
    if (!input) return null;
    return parseFloat(input.value);
}

function updateDepositPagePreview() {
    const amount = getDepositAmountValue();
    const btcEl = document.getElementById("depositPageBtcAmount");
    const usdEl = document.getElementById("depositPageUsdDisplay");
    if (!btcEl) return;

    if (!amount || amount <= 0) {
        btcEl.textContent = "—";
        if (usdEl) usdEl.textContent = "0.00";
        return;
    }

    if (usdEl) usdEl.textContent = amount.toFixed(2);
    const symbol = getSelectedDepositCurrency();
    const cryptoAmt = getDepositCryptoAmount(amount, symbol);
    btcEl.textContent = cryptoAmt ? "≈ " + formatDepositCryptoAmount(cryptoAmt, symbol) : "—";
}

function populateDepositPageAddress() {
    populateDepositCryptoSelect();
    return updateDepositCryptoDisplay();
}

function hideDepositConfirmSection() {
    const section = document.getElementById("depositConfirmSection");
    const addressBox = document.getElementById("depositAddressBox");
    const error = document.getElementById("depositAmountError");
    if (section) section.classList.add("hidden");
    if (addressBox) addressBox.classList.add("hidden");
    if (error) error.classList.add("hidden");
}

function showDepositConfirmSection() {
    const section = document.getElementById("depositConfirmSection");
    const addressBox = document.getElementById("depositAddressBox");
    if (addressBox) addressBox.classList.remove("hidden");
    if (section) section.classList.remove("hidden");
    updateDepositConfirmInstruction();
    updateDepositPagePreview();
}

function validateDepositAmount() {
    const amount = getDepositAmountValue();
    const error = document.getElementById("depositAmountError");
    const valid = amount && amount > 0;

    if (error) {
        if (valid) error.classList.add("hidden");
        else error.classList.remove("hidden");
    }

    return valid ? amount : null;
}

function openDepositPanel() {
    const panel = document.getElementById("depositPanel");
    const input = document.getElementById("depositAmountInput");
    if (!panel || !input) return;

    hideDepositConfirmSection();
    populateDepositPageAddress();
    loadMarketPrices().catch(function() { /* preview updates when prices load */ });
    panel.classList.remove("hidden");
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    input.value = "";
    input.focus();

    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeDepositPanel() {
    const panel = document.getElementById("depositPanel");
    if (panel) panel.classList.add("hidden");
    hideDepositConfirmSection();
}

function continueDepositFlow() {
    const amount = validateDepositAmount();
    if (!amount) {
        document.getElementById("depositAmountInput").focus();
        return;
    }

    const address = populateDepositPageAddress();
    if (!address) {
        alert("Deposit address is not configured yet. Please contact support.");
        return;
    }

    const wallet = getSelectedDepositWallet();
    const cfg = getDepositCryptoConfig();
    if (wallet && cfg && !cfg.validateWalletAddress(wallet.symbol, wallet.address)) {
        alert("Configured " + wallet.symbol + " deposit address is invalid. Please contact support.");
        return;
    }

    showDepositConfirmSection();
    loadMarketPrices().then(updateDepositPagePreview).catch(updateDepositPagePreview);
    document.getElementById("depositConfirmSection").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function submitDepositFromPanel() {
    const amount = validateDepositAmount();
    if (!amount) {
        hideDepositConfirmSection();
        document.getElementById("depositAmountInput").focus();
        return;
    }

    const wallet = getSelectedDepositWallet();
    if (!wallet || !wallet.address) {
        alert("Deposit address is not configured. Please contact support.");
        return;
    }

    const cfg = getDepositCryptoConfig();
    if (cfg && !cfg.validateWalletAddress(wallet.symbol, wallet.address)) {
        alert("Configured " + wallet.symbol + " deposit address is invalid. Please contact support.");
        return;
    }

    const symbol = wallet.symbol;
    const cryptoAmount = getDepositCryptoAmount(amount, symbol);
    if (cryptoAmount == null || !(cryptoAmount > 0)) {
        alert("Could not calculate the " + symbol + " amount. Wait for the live price and try again.");
        loadMarketPrices().then(updateDepositPagePreview).catch(updateDepositPagePreview);
        return;
    }
    const txInput = document.getElementById("depositTxHashInput");
    const txHash = txInput ? String(txInput.value || "").trim() : "";
    const depositMeta = {
        currency: symbol,
        cryptoAmount: cryptoAmount,
        network: wallet.network,
        txHash: txHash
    };
    const minUsd = wallet.minDepositUsd != null ? Number(wallet.minDepositUsd) : 50;
    if (minUsd > 0 && amount < minUsd) {
        alert("Minimum deposit is $" + minUsd.toFixed(2) + " for " + symbol + ".");
        return;
    }
    const submitHandler = typeof submitDepositRequestAsync === "function"
        ? submitDepositRequestAsync(username, amount, "crypto", depositMeta)
        : Promise.resolve(submitDepositRequest(username, amount, "crypto", depositMeta));

    const submitBtn = document.getElementById("depositSubmitBtn");
    if (submitBtn) submitBtn.disabled = true;

    submitHandler.then(function(result) {
        if (submitBtn) submitBtn.disabled = false;
        if (!result.ok) {
            alert(result.error || "Could not submit deposit.");
            return;
        }

        reloadAccountFromRegistry();
        closeDepositPanel();

        alert(buildDepositSuccessAlert(
            amount,
            symbol,
            cryptoAmount,
            result.payTo,
            result.emailSent !== false
        ));
    }).catch(function(err) {
        if (submitBtn) submitBtn.disabled = false;
        alert(err.message || "Could not submit deposit.");
    });
}

function openModal(type) {
    if (type !== "withdraw") return;

    const frozenMsg = typeof getWithdrawalsFrozenMessage === "function"
        ? getWithdrawalsFrozenMessage(username)
        : "";
    if (frozenMsg) {
        alert(frozenMsg);
        return;
    }

    document.getElementById("modalOverlay").classList.remove("hidden");
    document.getElementById("modalOverlay").dataset.type = type;
    document.getElementById("modalInput").value = "";
    document.getElementById("modalTitle").textContent = "💸 Withdraw Funds";
    document.getElementById("transferDetailsGroup").classList.remove("hidden");
    document.getElementById("transferDestination").value = "";
    document.getElementById("confirmModalBtn").textContent = "Submit Withdrawal for Approval";
    const availEl = document.getElementById("withdrawAvailable");
    if (availEl) {
        const pendingTotal = getUserPendingTransferTotal(username);
        availEl.textContent = "Available to withdraw: " + formatPrice(Math.max(account.cash - pendingTotal, 0)) +
            (pendingTotal > 0 ? " (" + formatPrice(pendingTotal) + " already pending)" : "");
    }
    document.getElementById("modalInput").focus();
}

function closeModal() {
    document.getElementById("modalOverlay").classList.add("hidden");
}

let withdrawSubmitting = false;

function confirmModal(e) {
    if (e) e.preventDefault();

    const amount = parseFloat(document.getElementById("modalInput").value);

    if (!amount || amount <= 0) {
        alert("Enter a valid amount.");
        return;
    }

    const destination = document.getElementById("transferDestination").value.trim();
    const method = document.querySelector('input[name="transferMethod"]:checked').value;

    if (!destination) {
        alert("Please enter the withdrawal destination.");
        return;
    }

    if (withdrawSubmitting) return;
    withdrawSubmitting = true;
    const confirmBtn = document.getElementById("confirmModalBtn");
    if (confirmBtn) confirmBtn.disabled = true;

    const submitHandler = typeof submitTransferRequestAsync === "function"
        ? submitTransferRequestAsync(username, amount, destination, method)
        : Promise.resolve(submitTransferRequest(username, amount, destination, method));

    submitHandler.catch(function() {
        return { ok: false, error: "Could not reach the server. Please try again." };
    }).then(function(result) {
        withdrawSubmitting = false;
        if (confirmBtn) confirmBtn.disabled = false;
        if (!result.ok) {
            alert(result.error);
            return;
        }

        reloadAccountFromRegistry();
        closeModal();
        if (typeof showToast === "function") {
            showToast("Withdrawal submitted for admin approval.");
        } else {
            alert("Withdrawal submitted for admin approval.");
        }
    });
}

const DASH_THEME_KEY = "securebank_dashboard_theme";

function preferredDashboardTheme() {
    try {
        const saved = localStorage.getItem(DASH_THEME_KEY);
        if (saved === "light" || saved === "dark") return saved;
    } catch (e) { /* ignore */ }
    return "dark";
}

function applyTheme(theme) {
    try { localStorage.setItem(DASH_THEME_KEY, theme); } catch (e) { /* ignore */ }
    account.theme = theme;
    account.settings.theme = theme;
    applyThemeToDocument(theme);
    saveState();
}

function toggleTheme() {
    /* Base the switch on what is actually displayed, not on a possibly stale account value. */
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function toggleDropdown(id) {
    const el = document.getElementById(id);
    const other = id === "notifPanel" ? "profileMenu" : "notifPanel";
    document.getElementById(other).classList.add("hidden");
    el.classList.toggle("hidden");
}

function logout() {
    clearSession();
    window.location.href = "login.html";
}

function initCharts() {
    if (typeof Chart === "undefined") return;

    const lineCtx = document.getElementById("portfolioChart");
    if (lineCtx) {
    lineChart = new Chart(lineCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "Portfolio Value",
                data: [],
                borderColor: "#3EE0A0",
                borderWidth: 3,
                fill: true,
                backgroundColor: "rgba(62, 224, 160, 0.10)",
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: "#8FA39A" },
                    grid: { color: "rgba(184, 193, 209, 0.08)" }
                },
                y: {
                    beginAtZero: false,
                    ticks: { color: "#8FA39A" },
                    grid: { color: "rgba(184, 193, 209, 0.08)" }
                }
            }
        }
    });
    }

    const pieCtx = document.getElementById("allocationChart");
    if (pieCtx) {
    pieChart = new Chart(pieCtx, {
        type: "doughnut",
        data: {
            labels: ["Cash", "Crypto", "Gold", "Stocks", "ETFs"],
            datasets: [{
                data: [1, 1, 1, 1, 1],
                backgroundColor: ["#1C2A25", "#1E7A5C", "#3EE0A0", "#9AF5C8", "#17221E"]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "#B8C1D1" }
                }
            }
        }
    });
    }
}

function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
}

function initUI() {
    applyTheme(preferredDashboardTheme());
    renderTransactions();
    initCharts();
    updateUI();
    loadMarketPrices();
    setInterval(loadMarketPrices, 30000);

    bindClick("depositBtn", openDepositPanel);
    bindClick("depositContinueBtn", continueDepositFlow);
    bindClick("depositSubmitBtn", submitDepositFromPanel);
    bindClick("depositBackBtn", hideDepositConfirmSection);
    bindClick("depositPanelCloseBtn", closeDepositPanel);
    bindClick("copyDepositPageBtn", function() {
        const wallet = getSelectedDepositWallet();
        copyText(wallet && wallet.address ? wallet.address : "", "Deposit address copied to clipboard.");
    });
    const depositCryptoSelect = document.getElementById("depositCryptoSelect");
    if (depositCryptoSelect) {
        depositCryptoSelect.addEventListener("change", function() {
            updateDepositCryptoDisplay();
            const section = document.getElementById("depositConfirmSection");
            if (section && !section.classList.contains("hidden")) {
                updateDepositPagePreview();
            }
        });
    }
    const depositAmountInput = document.getElementById("depositAmountInput");
    if (depositAmountInput) {
        depositAmountInput.addEventListener("input", function() {
            const section = document.getElementById("depositConfirmSection");
            if (section && !section.classList.contains("hidden")) {
                updateDepositPagePreview();
            } else {
                const errEl = document.getElementById("depositAmountError");
                if (errEl) errEl.classList.add("hidden");
            }
        });
        depositAmountInput.addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
                e.preventDefault();
                continueDepositFlow();
            }
        });
    }

    bindClick("withdrawBtn", function() {
        openModal("withdraw");
    });

    const cashForm = document.getElementById("cashForm");
    if (cashForm) cashForm.addEventListener("submit", confirmModal);
    bindClick("cancelModalBtn", closeModal);

    const modalOverlay = document.getElementById("modalOverlay");
    if (modalOverlay) {
        modalOverlay.addEventListener("click", function(e) {
            if (e.target === modalOverlay) closeModal();
        });
    }

    bindClick("profileBtn", function(e) {
        e.stopPropagation();
        toggleDropdown("profileMenu");
    });

    bindClick("themeToggle", toggleTheme);
    bindClick("logoutBtn", logout);
    bindClick("viewProfileBtn", function() {
        window.location.href = "profile.html";
    });
    bindClick("exchangeBtn", function() {
        window.location.href = "exchange.html";
    });
    bindClick("supportBtn", function() {
        window.location.href = "support.html";
    });
    bindClick("settingsBtn", function() {
        window.location.href = "settings.html";
    });
    bindClick("walletBtn", function() {
        window.location.href = "wallet.html";
    });

    const verificationBtn = document.getElementById("verificationProfileBtn");
    if (verificationBtn) {
        verificationBtn.addEventListener("click", function() {
            window.location.href = "profile.html";
        });
    }
    const securityBtn = document.getElementById("securityProfileBtn");
    if (securityBtn) {
        securityBtn.addEventListener("click", function() {
            window.location.href = "settings.html";
        });
    }

    const adminLink = document.getElementById("gvAdminLink");
    if (adminLink && (username === normalizeEmail("admin@globalvest.com") || isLegacyAdminEmail(username))) {
        adminLink.classList.remove("gv-hidden");
    }

    document.addEventListener("click", function(e) {
        if (!e.target.closest("#profileBtn") && !e.target.closest("#profileMenu")) {
            document.getElementById("profileMenu").classList.add("hidden");
        }
    });

    window.addEventListener("storage", function(e) {
        if (e.key === "securebank_accounts") {
            reloadAccountFromRegistry();
            refreshNotificationsFromStorage();
        }
    });

    window.addEventListener("globalvest-accounts-changed", function() {
        const fresh = typeof getAccount === "function" ? getAccount(username) : null;
        if (fresh && Array.isArray(fresh.notifications)) {
            account.notifications = fresh.notifications;
        }
        refreshNotificationsFromStorage();
    });

    window.addEventListener("globalvest-notifications-updated", function() {
        const fresh = typeof getAccount === "function" ? getAccount(username) : null;
        if (fresh && Array.isArray(fresh.notifications)) {
            account.notifications = fresh.notifications;
        }
        refreshNotificationsFromStorage();
    });

    window.addEventListener("globalvest-registry-synced", reloadAccountFromRegistry);

    function refreshUserBalanceFromServer() {
        if (typeof pullAccountsFromServer !== "function") return;
        pullAccountsFromServer().then(function() {
            reloadAccountFromRegistry();
            refreshNotificationsFromStorage();
        });
    }

    document.addEventListener("visibilitychange", function() {
        if (!document.hidden) refreshUserBalanceFromServer();
    });

    window.addEventListener("focus", refreshUserBalanceFromServer);
    setInterval(refreshUserBalanceFromServer, 12000);

    if (typeof initNotificationBell === "function") {
        initNotificationBell();
    }
}

function showDashboardBootError(err) {
    const main = document.querySelector(".gv-main");
    if (!main || document.getElementById("gvBootError")) return;
    const box = document.createElement("div");
    box.id = "gvBootError";
    box.className = "card gv-glass";
    box.style.marginBottom = "16px";
    box.style.borderColor = "rgba(248, 113, 113, 0.45)";
    box.innerHTML = "<strong>Dashboard could not fully load.</strong> " +
        "<p style=\"margin:8px 0 0;font-size:0.9rem;color:#9BAFA8\">Refresh the page or sign in again. " +
        (err && err.message ? "(" + String(err.message).replace(/</g, "&lt;") + ")" : "") + "</p>";
    main.prepend(box);
}

function bootstrapDashboard() {
    function startDashboard() {
        try {
            reloadAccountFromRegistry();
            initUI();
        } catch (err) {
            console.error("Dashboard init failed:", err);
            showDashboardBootError(err);
        }
    }

    startDashboard();

    if (typeof pullAccountsFromServer === "function") {
        pullAccountsFromServer()
            .then(function() {
                reloadAccountFromRegistry();
                if (typeof refreshNotificationsFromStorage === "function") {
                    refreshNotificationsFromStorage();
                }
            })
            .catch(function() { /* offline / API unavailable */ });
    }
}

function handleDashboardDeepLink() {
    let action = "";
    try {
        action = new URLSearchParams(window.location.search).get("action") || "";
    } catch (e) { return; }
    if (action === "deposit") openDepositPanel();
    else if (action === "withdraw") openModal("withdraw");
    if (action && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
}

bootstrapDashboard();
handleDashboardDeepLink();
