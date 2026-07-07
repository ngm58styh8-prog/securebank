const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureProfile(username, account);
ensureSettings(username, account);
ensureHoldings(account);
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

function saveState() {
    saveAccount(username, account);
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
    return total;
}

function categoryValue(category) {
    return ALL_ASSETS
        .filter(function(a) { return a.category === category; })
        .reduce(function(sum, a) { return sum + assetValue(a.key); }, 0);
}

function ensureBaseline() {
    if (account.baselineValue !== null) return;
    account.baselineValue = portfolioValue() || account.cash;
    saveState();
}

function addNotification(message) {
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: message,
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }
    saveState();
    renderNotifications();
}

function renderNotifications() {
    const list = document.getElementById("notifList");
    const count = document.getElementById("notifCount");
    ensureNotifications(account);
    const unread = account.notifications.filter(function(n) { return !n.read; }).length;

    count.textContent = unread;
    count.style.display = unread > 0 ? "inline" : "none";

    if (!list) return;

    if (!account.notifications.length) {
        list.innerHTML = '<div class="notif-item">No notifications yet.</div>';
        return;
    }

    list.innerHTML = account.notifications.map(function(n) {
        return `<div class="notif-item ${n.read ? "" : "unread"}">
            <span class="notif-check">✓</span> ${n.message}
            <div class="notif-time">${new Date(n.time).toLocaleString()}</div>
        </div>`;
    }).join("");
}

function markNotificationsRead() {
    account.notifications.forEach(function(n) { n.read = true; });
    saveState();
    renderNotifications();
}

function renderTransactions() {
    const tbody = document.getElementById("transactionBody");
    const recent = account.transactions.slice(0, 5);
    tbody.innerHTML = recent.map(function(t) {
        const sign = t.amount < 0 ? "-" : "+";
        return `<tr>
            <td>${t.date}</td>
            <td>${t.description}</td>
            <td>${sign}${formatMoney(Math.abs(t.amount), settings.currency)}</td>
        </tr>`;
    }).join("");
}

function addTransaction(description, amount) {
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: description,
        amount: amount
    });
    saveState();
    renderTransactions();
}

function updatePL() {
    ensureBaseline();
    const current = portfolioValue();
    const pl = current - account.baselineValue;
    const pct = account.baselineValue ? (pl / account.baselineValue) * 100 : 0;
    const plEl = document.getElementById("plValue");
    const pctEl = document.getElementById("plPercent");

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

    if (analytics.dayStartDate !== today) {
        analytics.dayStartValue = total;
        analytics.dayStartDate = today;
    }
    if (analytics.monthStartMonth !== month) {
        analytics.monthStartValue = total;
        analytics.monthStartMonth = month;
    }
    saveState();

    const todayProfit = total - (analytics.dayStartValue || total);
    const monthProfit = total - (analytics.monthStartValue || total);
    const monthPct = analytics.monthStartValue ? (monthProfit / analytics.monthStartValue) * 100 : 0;

    document.getElementById("totalAssets").textContent = formatPrice(total);

    const todayEl = document.getElementById("todayProfit");
    todayEl.textContent = (todayProfit >= 0 ? "+" : "") + formatPrice(todayProfit);
    todayEl.className = "balance " + (todayProfit >= 0 ? "pl-positive" : "pl-negative");

    const dayPct = analytics.dayStartValue ? (todayProfit / analytics.dayStartValue) * 100 : 0;
    const heroVal = document.getElementById("heroPortfolioValue");
    const heroGain = document.getElementById("heroTodayGain");
    if (heroVal) {
        if (typeof window.animateHeroPortfolio === "function") {
            window.animateHeroPortfolio(total, formatPrice(total));
        } else {
            heroVal.textContent = formatPrice(total);
        }
    }
    if (heroGain) {
        const arrow = todayProfit >= 0 ? "▲" : "▼";
        heroGain.textContent = arrow + " " + (todayProfit >= 0 ? "+" : "") + formatPrice(todayProfit) +
            " (" + (dayPct >= 0 ? "+" : "") + dayPct.toFixed(2) + "%)";
        heroGain.className = "gv-hero-gain " + (todayProfit >= 0 ? "pl-positive" : "pl-negative");
    }

    const monthEl = document.getElementById("monthlyReturn");
    monthEl.textContent = (monthPct >= 0 ? "+" : "") + monthPct.toFixed(2) + "%";
    monthEl.className = "balance " + (monthPct >= 0 ? "pl-positive" : "pl-negative");

    let best = { label: "—", change: -Infinity };
    let worst = { label: "—", change: Infinity };
    ALL_ASSETS.forEach(function(asset) {
        const ch = changes[asset.key] || 0;
        if (!prices[asset.key]) return;
        if (ch > best.change) best = { label: asset.label, change: ch };
        if (ch < worst.change) worst = { label: asset.label, change: ch };
    });

    document.getElementById("bestCoin").innerHTML = best.label !== "—"
        ? `${best.label} ${formatChange(best.change)}` : "—";
    document.getElementById("worstCoin").innerHTML = worst.label !== "—"
        ? `${worst.label} ${formatChange(worst.change)}` : "—";
}

function renderAssetCard(asset) {
    const h = getHoldings(asset.key);
    const holdingsEl = document.getElementById(asset.key + "Holdings");
    const priceEl = document.getElementById(asset.key + "Price");
    const changeEl = document.getElementById(asset.key + "Change");

    if (!holdingsEl) return;

    holdingsEl.textContent = formatHoldingsDisplay(asset, h);
    priceEl.innerHTML = prices[asset.key]
        ? `<span class="live-dot"></span>${asset.symbol} ${formatPrice(prices[asset.key])}`
        : "Loading...";
    changeEl.innerHTML = prices[asset.key] ? formatChange(changes[asset.key]) : "—";

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

function refreshNotificationsFromStorage() {
    syncAccountNotifications(username, account);
    renderNotifications();
}

function reloadAccountFromRegistry() {
    const fresh = typeof getRegistryAccount === "function"
        ? getRegistryAccount(username)
        : getAccount(username);
    if (!fresh) return;
    account.cash = fresh.cash;
    account.transactions = fresh.transactions || account.transactions;
    account.notifications = fresh.notifications || account.notifications;
    account.holdings = fresh.holdings || account.holdings;
    account.pendingDeposits = fresh.pendingDeposits || account.pendingDeposits;
    ensureProfile(username, account);
    ensureSettings(username, account);
    ensureHoldings(account);
    syncAccountNotifications(username, account);
    updateUI();
}

function updateUI() {
    const pendingTotal = getUserPendingTransferTotal(username);
    const available = account.cash - pendingTotal;

    document.getElementById("accountBalance").textContent = formatPrice(account.cash);
    const balanceCard = document.getElementById("accountBalance");
    if (balanceCard && pendingTotal > 0) {
        balanceCard.title = "Available: " + formatPrice(available) + " (" + formatPrice(pendingTotal) + " pending approval)";
    }

    renderPendingTransfers();
    const displayName = account.profile ? account.profile.fullName : username;
    document.getElementById("userName").textContent = displayName;
    document.getElementById("profileName").textContent = displayName;

    ALL_ASSETS.forEach(renderAssetCard);
    ALL_ASSETS.forEach(updateMarketRow);

    updatePL();
    updateCharts();
    updateAnalytics();
    refreshNotificationsFromStorage();
    renderVerificationBanner();
}

function checkPriceAlerts() {
    ALL_ASSETS.forEach(function(asset) {
        const change = changes[asset.key];
        if (change == null || !prices[asset.key]) return;

        const prev = account.lastAlerts[asset.key];
        const sign = change >= 0 ? "+" : "";

        if (Math.abs(change) >= 2 && (!prev || Math.abs(change - prev) >= 0.5)) {
            addNotification(asset.label + " price " + sign + change.toFixed(1) + "% today");
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
            addNotification("Buy failed — insufficient cash for " + asset.label);
            return;
        }
        account.cash -= cost;
        setHoldings(assetKey, getHoldings(assetKey) + qty);
        addNotification(asset.label + " purchased successfully");
        addTransaction("Buy " + formatQuantity(asset, qty), -cost);
    } else {
        if (getHoldings(assetKey) < qty) return;
        const proceeds = price * qty;
        setHoldings(assetKey, getHoldings(assetKey) - qty);
        account.cash += proceeds;
        addTransaction("Sell " + formatQuantity(asset, qty), proceeds);
        addNotification("Sold " + formatQuantity(asset, qty));
    }

    saveState();
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
    if (!usdAmount || usdAmount <= 0 || !prices.btc) return null;
    return usdAmount / prices.btc;
}

function formatBtcAmount(btc) {
    if (!btc || btc <= 0) return "—";
    return btc.toFixed(8) + " BTC";
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
    const btc = getDepositBtcAmount(amount);
    btcEl.textContent = btc ? "≈ " + formatBtcAmount(btc) : "—";
}

function populateDepositPageAddress() {
    const address = getAdminBtcAddress();
    const el = document.getElementById("depositPageAddress");
    if (el) {
        el.textContent = address || "Deposit address not configured — contact support.";
    }
    return address;
}

function hideDepositConfirmSection() {
    const section = document.getElementById("depositConfirmSection");
    const error = document.getElementById("depositAmountError");
    if (section) section.classList.add("hidden");
    if (error) error.classList.add("hidden");
}

function showDepositConfirmSection() {
    const section = document.getElementById("depositConfirmSection");
    if (section) section.classList.remove("hidden");
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

    const wallet = getAdminWalletAddress();
    if (!wallet) {
        alert("Deposit address is not configured. Please contact support.");
        return;
    }

    const btcAmount = getDepositBtcAmount(amount);
    const result = submitDepositRequest(username, amount, "crypto", btcAmount);
    if (!result.ok) {
        alert(result.error);
        return;
    }

    saveState();
    updateUI();
    closeDepositPanel();

    const btcLine = btcAmount ? formatBtcAmount(btcAmount) : "the matching BTC amount";
    alert("Deposit submitted for admin approval.\n\n" +
        "USD amount: $" + amount.toFixed(2) + "\n" +
        "Send " + btcLine + " to:\n\n" +
        result.payTo + "\n\n" +
        "Your balance will NOT update until an admin verifies your BTC payment and approves this deposit.\n\n" +
        "A confirmation email was sent to your inbox.");
}

function renderPendingTransfers() {
    const transfers = getUserPendingTransfers(username);
    const deposits = getUserPendingDeposits(username);
    const card = document.getElementById("pendingTransfersCard");
    const list = document.getElementById("pendingTransfersList");
    if (!card || !list) return;

    const items = transfers.map(function(t) {
        return `<li class="pending-item">
            <span>Transfer ${formatPrice(t.amount)} → ${t.destination}</span>
            <span class="pending-badge">Awaiting approval</span>
        </li>`;
    }).concat(deposits.map(function(d) {
        const btcLine = d.btcAmount ? " · ≈ " + d.btcAmount.toFixed(8) + " BTC" : "";
        const dest = d.payTo
            ? `<br><span class="admin-email">${d.payTo}</span>` : "";
        return `<li class="pending-item">
            <span>Deposit ${formatPrice(d.amount)} via BTC${btcLine}${dest}<br><em>Awaiting admin approval — not credited yet</em></span>
            <span class="pending-badge">Pending</span>
        </li>`;
    }));

    if (!items.length) {
        card.classList.add("hidden");
        return;
    }

    card.classList.remove("hidden");
    list.innerHTML = items.join("");
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
    document.getElementById("modalTitle").textContent = "💸 Request Transfer";
    document.getElementById("transferDetailsGroup").classList.remove("hidden");
    document.getElementById("transferDestination").value = "";
    document.getElementById("confirmModalBtn").textContent = "Submit Transfer for Approval";
    document.getElementById("modalInput").focus();
}

function closeModal() {
    document.getElementById("modalOverlay").classList.add("hidden");
}

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
        alert("Please enter where to send the transfer.");
        return;
    }

    const result = submitTransferRequest(username, amount, destination, method);
    if (!result.ok) {
        alert(result.error);
        return;
    }

    saveState();
    updateUI();
    closeModal();
    alert("Transfer submitted for admin approval. Your balance is not affected until an admin approves it.\n\nA confirmation email was sent to your inbox.");
}

function applyTheme(theme) {
    account.theme = theme;
    account.settings.theme = theme;
    applyThemeToDocument(theme);
    saveState();
}

function toggleTheme() {
    applyTheme(account.theme === "dark" ? "light" : "dark");
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
    const lineCtx = document.getElementById("portfolioChart");
    lineChart = new Chart(lineCtx, {
        type: "line",
        data: {
            labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"],
            datasets: [{
                label: "Portfolio Value",
                data: [12000, 14500, 17000, 19000, 21000, 24000, 25480],
                borderColor: "#1F6BFF",
                borderWidth: 3,
                fill: true,
                backgroundColor: "rgba(31, 107, 255, 0.08)",
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: false } }
        }
    });

    const pieCtx = document.getElementById("allocationChart");
    pieChart = new Chart(pieCtx, {
        type: "doughnut",
        data: {
            labels: ["Cash", "Crypto", "Gold", "Stocks", "ETFs"],
            datasets: [{
                data: [1, 1, 1, 1, 1],
                backgroundColor: ["#1F6BFF", "#3B82F6", "#FFB300", "#00C853", "#627eea"]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom" } }
        }
    });
}

function initUI() {
    applyTheme(settings.theme || "dark");
    renderTransactions();
    initCharts();
    updateUI();
    loadMarketPrices();
    setInterval(loadMarketPrices, 30000);

    document.getElementById("depositBtn").addEventListener("click", openDepositPanel);
    document.getElementById("depositContinueBtn").addEventListener("click", continueDepositFlow);
    document.getElementById("depositSubmitBtn").addEventListener("click", submitDepositFromPanel);
    document.getElementById("depositBackBtn").addEventListener("click", hideDepositConfirmSection);
    document.getElementById("depositPanelCloseBtn").addEventListener("click", closeDepositPanel);
    document.getElementById("copyDepositPageBtn").addEventListener("click", function() {
        copyText(getAdminBtcAddress(), "Deposit address copied to clipboard.");
    });
    document.getElementById("depositAmountInput").addEventListener("input", function() {
        const section = document.getElementById("depositConfirmSection");
        if (section && !section.classList.contains("hidden")) {
            updateDepositPagePreview();
        } else {
            document.getElementById("depositAmountError").classList.add("hidden");
        }
    });
    document.getElementById("depositAmountInput").addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            continueDepositFlow();
        }
    });

    document.getElementById("withdrawBtn").addEventListener("click", function() {
        openModal("withdraw");
    });

    document.getElementById("cashForm").addEventListener("submit", confirmModal);
    document.getElementById("cancelModalBtn").addEventListener("click", closeModal);

    document.getElementById("modalOverlay").addEventListener("click", function(e) {
        if (e.target === document.getElementById("modalOverlay")) {
            closeModal();
        }
    });

    document.getElementById("notifBtn").addEventListener("click", function(e) {
        e.stopPropagation();
        const panel = document.getElementById("notifPanel");
        const opening = panel.classList.contains("hidden");
        toggleDropdown("notifPanel");
        if (opening) markNotificationsRead();
    });

    document.getElementById("profileBtn").addEventListener("click", function(e) {
        e.stopPropagation();
        toggleDropdown("profileMenu");
    });

    document.getElementById("themeToggle").addEventListener("click", toggleTheme);
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("viewProfileBtn").addEventListener("click", function() {
        window.location.href = "profile.html";
    });
    document.getElementById("exchangeBtn").addEventListener("click", function() {
        window.location.href = "exchange.html";
    });
    document.getElementById("supportBtn").addEventListener("click", function() {
        window.location.href = "support.html";
    });
    document.getElementById("settingsBtn").addEventListener("click", function() {
        window.location.href = "settings.html";
    });
    document.getElementById("walletBtn").addEventListener("click", function() {
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
        if (!e.target.closest("#notifBtn") && !e.target.closest("#notifPanel")) {
            document.getElementById("notifPanel").classList.add("hidden");
        }
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

    setInterval(refreshNotificationsFromStorage, 3000);
}

initUI();
