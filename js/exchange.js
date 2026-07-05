const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
ensureExchangeHistory(account);
const settings = getSettings(account);
let btcPrice = 0;

function saveState() {
    saveAccount(username, account);
}

function formatPrice(amount) {
    return formatMoney(amount, settings.currency);
}

async function loadBtcPrice() {
    try {
        const response = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        );
        if (response.ok) {
            const data = await response.json();
            btcPrice = data.bitcoin.usd;
        }
    } catch (e) { /* ignore */ }
    if (!btcPrice) btcPrice = 65000;
    document.getElementById("exchangeBtcPrice").textContent = formatPrice(btcPrice);
}

function updateBalances() {
    document.getElementById("exchangeCash").textContent = formatPrice(account.cash || 0);
    const btc = account.holdings && account.holdings.btc ? account.holdings.btc : 0;
    document.getElementById("exchangeBtc").textContent = btc.toFixed(8) + " BTC";
}

function updateConvertHint() {
    const direction = document.getElementById("convertDirection").value;
    document.getElementById("convertHint").textContent = direction === "cash-to-btc"
        ? "Enter USD amount to spend on BTC."
        : "Enter BTC amount to sell for cash.";
    document.getElementById("convertAmount").placeholder = direction === "cash-to-btc" ? "100.00" : "0.001";
}

function renderExchangeHistory() {
    const tbody = document.getElementById("exchangeHistoryBody");
    const history = account.exchangeHistory || [];
    if (!history.length) {
        tbody.innerHTML = "<tr><td colspan=\"4\">No exchanges yet.</td></tr>";
        return;
    }
    tbody.innerHTML = history.map(function(item) {
        return "<tr><td>" + item.date + "</td><td>" + item.type + "</td><td>" +
            item.details + "</td><td>" + item.amount + "</td></tr>";
    }).join("");
}

function convertCryptoCash(amount, direction) {
    if (!btcPrice) return { ok: false, error: "BTC price unavailable. Try again shortly." };
    if (!account.holdings) account.holdings = {};
    if (account.holdings.btc == null) account.holdings.btc = 0;

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
            amount: formatPrice(amount) + " → " + btcReceived.toFixed(8) + " BTC"
        });
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
        amount: amount.toFixed(8) + " BTC → " + formatPrice(cashReceived)
    });
    return { ok: true, message: "Converted " + amount.toFixed(8) + " BTC to " + formatPrice(cashReceived) + "." };
}

function runFxConvert() {
    const amount = parseFloat(document.getElementById("fxAmount").value);
    const from = document.getElementById("fxFrom").value;
    const to = document.getElementById("fxTo").value;
    if (!amount || amount <= 0) {
        document.getElementById("fxResult").textContent = "Enter a valid amount.";
        return;
    }
    const usd = amount / FX_RATES[from];
    const converted = usd * FX_RATES[to];
    const symbols = { USD: "$", EUR: "€", GBP: "£" };
    document.getElementById("fxResult").textContent =
        symbols[from] + amount.toFixed(2) + " " + from + " = " +
        symbols[to] + converted.toFixed(2) + " " + to;
    ensureExchangeHistory(account).unshift({
        id: Date.now() + Math.random(),
        time: new Date().toISOString(),
        date: new Date().toLocaleString(),
        type: "Currency",
        details: from + " → " + to,
        amount: amount.toFixed(2) + " " + from + " → " + converted.toFixed(2) + " " + to
    });
    saveState();
    renderExchangeHistory();
}

initPageNav("exchange");
updateBalances();
updateConvertHint();
loadBtcPrice().then(function() {
    updateBalances();
    renderExchangeHistory();
});

document.getElementById("convertDirection").addEventListener("change", updateConvertHint);

document.getElementById("convertForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("convertAmount").value);
    const direction = document.getElementById("convertDirection").value;
    if (!amount || amount <= 0) {
        alert("Enter a valid amount.");
        return;
    }
    const result = convertCryptoCash(amount, direction);
    if (!result.ok) {
        alert(result.error);
        return;
    }
    saveState();
    updateBalances();
    renderExchangeHistory();
    document.getElementById("convertAmount").value = "";
    alert(result.message);
});

document.getElementById("fxConvertBtn").addEventListener("click", runFxConvert);
