/**
 * Cryptocurrency deposit wallet configuration (server).
 * Add future assets by extending DEFAULT_CRYPTO_DEPOSIT_WALLETS only.
 */
const DEFAULT_CRYPTO_DEPOSIT_WALLETS = [
    {
        symbol: "BTC",
        name: "Bitcoin",
        address: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2"
    },
    {
        symbol: "ETH",
        name: "Ethereum",
        address: "0xC3eFfb72DFE7296e29c386c1C366b42Adb7E857F"
    }
];

const LEGACY_DEMO_BTC = "bc1qsecurebank0ff1c1aladm1nwalle7demo2024";

function normalizeSymbol(symbol) {
    return String(symbol || "BTC").trim().toUpperCase();
}

function validateBtcAddress(address) {
    const value = String(address || "").trim();
    if (!value) return false;
    if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) return true;
    if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) return true;
    if (/^bc1[a-z0-9]{25,90}$/i.test(value)) return true;
    return false;
}

function validateEthAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(address || "").trim());
}

function validateWalletAddress(symbol, address) {
    const sym = normalizeSymbol(symbol);
    if (sym === "BTC") return validateBtcAddress(address);
    if (sym === "ETH") return validateEthAddress(address);
    return String(address || "").trim().length >= 8;
}

function mergeWalletEntry(defaultEntry, overrideEntry) {
    const merged = Object.assign({}, defaultEntry, overrideEntry || {});
    merged.symbol = normalizeSymbol(merged.symbol || defaultEntry.symbol);
    merged.name = String(merged.name || defaultEntry.name || merged.symbol).trim();
    merged.address = String(merged.address || defaultEntry.address || "").trim();
    return merged;
}

function normalizeCryptoDepositWallets(adminOrWallets) {
    let overrides = [];
    let legacyBtc = null;

    if (Array.isArray(adminOrWallets)) {
        overrides = adminOrWallets;
    } else if (adminOrWallets && typeof adminOrWallets === "object") {
        if (Array.isArray(adminOrWallets.cryptoDepositWallets)) {
            overrides = adminOrWallets.cryptoDepositWallets;
        }
        legacyBtc = adminOrWallets.walletAddress;
    }

    const bySymbol = {};
    DEFAULT_CRYPTO_DEPOSIT_WALLETS.forEach(function(entry) {
        bySymbol[entry.symbol] = mergeWalletEntry(entry, null);
    });

    overrides.forEach(function(entry) {
        if (!entry || !entry.symbol) return;
        const sym = normalizeSymbol(entry.symbol);
        const base = bySymbol[sym] || { symbol: sym, name: sym, address: "" };
        bySymbol[sym] = mergeWalletEntry(base, entry);
    });

    if (legacyBtc && String(legacyBtc).trim()) {
        const btc = String(legacyBtc).trim();
        if (btc !== LEGACY_DEMO_BTC) {
            bySymbol.BTC = mergeWalletEntry(bySymbol.BTC || DEFAULT_CRYPTO_DEPOSIT_WALLETS[0], {
                symbol: "BTC",
                address: btc
            });
        }
    }

    return DEFAULT_CRYPTO_DEPOSIT_WALLETS.map(function(entry) {
        return bySymbol[entry.symbol] || entry;
    });
}

function getWalletBySymbol(adminOrWallets, symbol) {
    const sym = normalizeSymbol(symbol);
    const wallets = normalizeCryptoDepositWallets(adminOrWallets);
    return wallets.find(function(entry) {
        return entry.symbol === sym;
    }) || null;
}

function getWalletAddressForCurrency(adminOrWallets, symbol) {
    const wallet = getWalletBySymbol(adminOrWallets, symbol);
    return wallet && wallet.address ? wallet.address : "";
}

function getDepositSendLabel(symbol, name) {
    const sym = normalizeSymbol(symbol);
    const assetName = name || sym;
    return "Send " + assetName + " (" + sym + ") to:";
}

function formatDepositCurrencyLabel(symbol, name) {
    const sym = normalizeSymbol(symbol);
    return (name || sym) + " (" + sym + ")";
}

function normalizeDepositCurrencyFields(deposit) {
    const currency = normalizeSymbol(deposit.currency || deposit.cryptoAsset || "BTC");
    const wallet = getWalletBySymbol(null, currency);
    const cryptoAmount = deposit.cryptoAmount != null
        ? Number(deposit.cryptoAmount)
        : (currency === "BTC" && deposit.btcAmount != null
            ? Number(deposit.btcAmount)
            : (currency === "ETH" && deposit.ethAmount != null ? Number(deposit.ethAmount) : null));

    const walletAddress = String(
        deposit.walletAddress || deposit.payTo || getWalletAddressForCurrency(null, currency) || ""
    ).trim();

    const normalized = {
        currency: currency,
        cryptoAsset: currency,
        walletAddress: walletAddress,
        payTo: walletAddress,
        cryptoAmount: cryptoAmount && !isNaN(cryptoAmount) ? cryptoAmount : null
    };

    if (currency === "BTC") normalized.btcAmount = normalized.cryptoAmount;
    if (currency === "ETH") normalized.ethAmount = normalized.cryptoAmount;

    return normalized;
}

module.exports = {
    DEFAULT_CRYPTO_DEPOSIT_WALLETS,
    normalizeSymbol,
    validateBtcAddress,
    validateEthAddress,
    validateWalletAddress,
    normalizeCryptoDepositWallets,
    getWalletBySymbol,
    getWalletAddressForCurrency,
    getDepositSendLabel,
    formatDepositCurrencyLabel,
    normalizeDepositCurrencyFields
};
