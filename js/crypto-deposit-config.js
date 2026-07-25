/**
 * Cryptocurrency deposit wallet configuration (browser).
 * Keep in sync with server-lib/crypto-deposit-config.js defaults.
 */
(function(global) {
    "use strict";

    var DEFAULT_CRYPTO_DEPOSIT_WALLETS = [
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

    var LEGACY_DEMO_BTC = "bc1qsecurebank0ff1c1aladm1nwalle7demo2024";

    function normalizeSymbol(symbol) {
        return String(symbol || "BTC").trim().toUpperCase();
    }

    function validateBtcAddress(address) {
        var value = String(address || "").trim();
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
        var sym = normalizeSymbol(symbol);
        if (sym === "BTC") return validateBtcAddress(address);
        if (sym === "ETH") return validateEthAddress(address);
        return String(address || "").trim().length >= 8;
    }

    function mergeWalletEntry(defaultEntry, overrideEntry) {
        var merged = Object.assign({}, defaultEntry, overrideEntry || {});
        merged.symbol = normalizeSymbol(merged.symbol || defaultEntry.symbol);
        merged.name = String(merged.name || defaultEntry.name || merged.symbol).trim();
        merged.address = String(merged.address || defaultEntry.address || "").trim();
        return merged;
    }

    function normalizeCryptoDepositWallets(adminOrWallets) {
        var overrides = [];
        var legacyBtc = null;

        if (Array.isArray(adminOrWallets)) {
            overrides = adminOrWallets;
        } else if (adminOrWallets && typeof adminOrWallets === "object") {
            if (Array.isArray(adminOrWallets.cryptoDepositWallets)) {
                overrides = adminOrWallets.cryptoDepositWallets;
            }
            legacyBtc = adminOrWallets.walletAddress;
        }

        var bySymbol = {};
        DEFAULT_CRYPTO_DEPOSIT_WALLETS.forEach(function(entry) {
            bySymbol[entry.symbol] = mergeWalletEntry(entry, null);
        });

        overrides.forEach(function(entry) {
            if (!entry || !entry.symbol) return;
            var sym = normalizeSymbol(entry.symbol);
            var base = bySymbol[sym] || { symbol: sym, name: sym, address: "" };
            bySymbol[sym] = mergeWalletEntry(base, entry);
        });

        if (legacyBtc && String(legacyBtc).trim()) {
            var btc = String(legacyBtc).trim();
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
        var sym = normalizeSymbol(symbol);
        var wallets = normalizeCryptoDepositWallets(adminOrWallets);
        for (var i = 0; i < wallets.length; i++) {
            if (wallets[i].symbol === sym) return wallets[i];
        }
        return null;
    }

    function getWalletAddressForCurrency(adminOrWallets, symbol) {
        var wallet = getWalletBySymbol(adminOrWallets, symbol);
        return wallet && wallet.address ? wallet.address : "";
    }

    function getDepositSendLabel(symbol, name) {
        var sym = normalizeSymbol(symbol);
        var assetName = name || sym;
        return "Send " + assetName + " (" + sym + ") to:";
    }

    function formatDepositCurrencyLabel(symbol, name) {
        var sym = normalizeSymbol(symbol);
        return (name || sym) + " (" + sym + ")";
    }

    function getCryptoAmountForUsd(usdAmount, symbol, priceMap) {
        var sym = normalizeSymbol(symbol);
        var priceKey = sym === "BTC" ? "btc" : sym === "ETH" ? "eth" : sym.toLowerCase();
        var price = priceMap && priceMap[priceKey] ? Number(priceMap[priceKey]) : 0;
        if (!usdAmount || usdAmount <= 0 || !price) return null;
        return usdAmount / price;
    }

    function formatCryptoAmount(amount, symbol) {
        if (!amount || amount <= 0) return "—";
        var sym = normalizeSymbol(symbol);
        if (sym === "BTC") return amount.toFixed(8) + " BTC";
        if (sym === "ETH") return amount.toFixed(6) + " ETH";
        return amount.toFixed(6) + " " + sym;
    }

    global.CryptoDepositConfig = {
        DEFAULT_CRYPTO_DEPOSIT_WALLETS: DEFAULT_CRYPTO_DEPOSIT_WALLETS,
        normalizeSymbol: normalizeSymbol,
        validateBtcAddress: validateBtcAddress,
        validateEthAddress: validateEthAddress,
        validateWalletAddress: validateWalletAddress,
        normalizeCryptoDepositWallets: normalizeCryptoDepositWallets,
        getWalletBySymbol: getWalletBySymbol,
        getWalletAddressForCurrency: getWalletAddressForCurrency,
        getDepositSendLabel: getDepositSendLabel,
        formatDepositCurrencyLabel: formatDepositCurrencyLabel,
        getCryptoAmountForUsd: getCryptoAmountForUsd,
        formatCryptoAmount: formatCryptoAmount
    };
})(typeof window !== "undefined" ? window : globalThis);
