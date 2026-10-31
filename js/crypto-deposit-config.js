/**
 * Cryptocurrency deposit wallet configuration (browser).
 * Keep in sync with server-lib/crypto-deposit-config.js
 */
(function(global) {
    "use strict";

    var CRYPTO_DEPOSIT_CONFIG = {
        BTC: {
            name: "Bitcoin",
            symbol: "BTC",
            network: "Bitcoin Mainnet",
            address: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
            enabled: false,
            verified: false
        },
        ETH: {
            name: "Ethereum",
            symbol: "ETH",
            network: "Ethereum Mainnet",
            address: "0xC3eFfb72DFE7296e29c386c1C366b42Adb7E857F",
            enabled: false,
            verified: false
        }
    };

    var LEGACY_DEMO_BTC = "bc1qsecurebank0ff1c1aladm1nwalle7demo2024";
    var DEMO_PLACEHOLDER_RE = /DEMO-|DO-NOT-SEND-FUNDS/i;

    function normalizeSymbol(symbol) {
        return String(symbol || "BTC").trim().toUpperCase();
    }

    function isDemoPlaceholderAddress(address) {
        var value = String(address || "").trim();
        if (!value) return true;
        return DEMO_PLACEHOLDER_RE.test(value);
    }

    function validateBtcAddress(address) {
        var value = String(address || "").trim();
        if (!value || isDemoPlaceholderAddress(value)) return false;
        if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) return true;
        if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) return true;
        if (/^bc1[a-z0-9]{25,90}$/i.test(value)) return true;
        return false;
    }

    function validateEthAddress(address) {
        var value = String(address || "").trim();
        if (!value || isDemoPlaceholderAddress(value)) return false;
        return /^0x[a-fA-F0-9]{40}$/.test(value);
    }

    function validateWalletAddress(symbol, address) {
        var sym = normalizeSymbol(symbol);
        if (sym === "BTC") return validateBtcAddress(address);
        if (sym === "ETH") return validateEthAddress(address);
        return String(address || "").trim().length >= 8 && !isDemoPlaceholderAddress(address);
    }

    function configEntryToWallet(entry, symbol) {
        var sym = normalizeSymbol(symbol);
        var base = entry || CRYPTO_DEPOSIT_CONFIG[sym];
        if (!base) return null;
        return {
            symbol: sym,
            name: base.name || sym,
            network: base.network || sym,
            address: String(base.address || "").trim(),
            enabled: !!base.enabled,
            verified: !!base.verified
        };
    }

    function getDefaultCryptoDepositWallets() {
        return Object.keys(CRYPTO_DEPOSIT_CONFIG).map(function(sym) {
            return configEntryToWallet(CRYPTO_DEPOSIT_CONFIG[sym], sym);
        });
    }

    function mergeWalletEntry(defaultEntry, overrideEntry) {
        var merged = Object.assign({}, defaultEntry, overrideEntry || {});
        merged.symbol = normalizeSymbol(merged.symbol || defaultEntry.symbol);
        merged.name = String(merged.name || defaultEntry.name || merged.symbol).trim();
        merged.network = String(merged.network || defaultEntry.network || merged.symbol).trim();
        merged.address = String(merged.address || defaultEntry.address || "").trim();
        if (isDemoPlaceholderAddress(merged.address)) {
            merged.address = String(defaultEntry.address || "").trim();
        }
        merged.enabled = !!merged.enabled;
        merged.verified = !!merged.verified;
        return merged;
    }

    function normalizeCryptoDepositWallets(adminOrWallets) {
        var defaults = getDefaultCryptoDepositWallets();
        var bySymbol = {};
        defaults.forEach(function(entry) {
            bySymbol[entry.symbol] = mergeWalletEntry(entry, null);
        });

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

        overrides.forEach(function(entry) {
            if (!entry || !entry.symbol) return;
            var sym = normalizeSymbol(entry.symbol);
            var base = bySymbol[sym] || configEntryToWallet(CRYPTO_DEPOSIT_CONFIG[sym], sym);
            if (!base) return;
            bySymbol[sym] = mergeWalletEntry(base, entry);
        });

        if (legacyBtc && String(legacyBtc).trim()) {
            var btc = String(legacyBtc).trim();
            if (btc !== LEGACY_DEMO_BTC && !isDemoPlaceholderAddress(btc)) {
                bySymbol.BTC = mergeWalletEntry(bySymbol.BTC || defaults[0], {
                    symbol: "BTC",
                    address: btc
                });
            }
        }

        return defaults.map(function(entry) {
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

    function isWalletDepositLive(wallet) {
        if (!wallet || !wallet.address) return false;
        if (isDemoPlaceholderAddress(wallet.address)) return false;
        if (!validateWalletAddress(wallet.symbol, wallet.address)) return false;
        return !!wallet.enabled && !!wallet.verified;
    }

    function getCustomerDisplayAddress(wallet) {
        if (!wallet) return "";
        var addr = String(wallet.address || "").trim();
        if (!addr || isDemoPlaceholderAddress(addr)) return "";
        if (!validateWalletAddress(wallet.symbol, addr)) return "";
        return addr;
    }

    function getQrCodePayload(symbol, address) {
        var addr = String(address || "").trim();
        if (!addr) return "";
        var sym = normalizeSymbol(symbol);
        if (sym === "BTC") return "bitcoin:" + addr;
        return addr;
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

    function inferDepositCurrency(deposit) {
        deposit = deposit || {};
        if (deposit.currency) return normalizeSymbol(deposit.currency);
        if (deposit.cryptoAsset) return normalizeSymbol(deposit.cryptoAsset);
        if (deposit.ethAmount != null && deposit.ethAmount !== "" && deposit.btcAmount == null) {
            return "ETH";
        }
        var addr = String(deposit.walletAddress || deposit.payTo || "").trim();
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return "ETH";
        return "BTC";
    }

    function normalizeDepositCurrencyFields(deposit) {
        var currency = inferDepositCurrency(deposit);
        var cryptoAmount = deposit.cryptoAmount != null
            ? Number(deposit.cryptoAmount)
            : (currency === "BTC" && deposit.btcAmount != null
                ? Number(deposit.btcAmount)
                : (currency === "ETH" && deposit.ethAmount != null ? Number(deposit.ethAmount) : null));
        var walletAddress = String(
            deposit.walletAddress || deposit.payTo || getWalletAddressForCurrency(null, currency) || ""
        ).trim();
        var normalized = {
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

    global.CryptoDepositConfig = {
        CRYPTO_DEPOSIT_CONFIG: CRYPTO_DEPOSIT_CONFIG,
        getDefaultCryptoDepositWallets: getDefaultCryptoDepositWallets,
        normalizeSymbol: normalizeSymbol,
        validateBtcAddress: validateBtcAddress,
        validateEthAddress: validateEthAddress,
        validateWalletAddress: validateWalletAddress,
        isDemoPlaceholderAddress: isDemoPlaceholderAddress,
        normalizeCryptoDepositWallets: normalizeCryptoDepositWallets,
        getWalletBySymbol: getWalletBySymbol,
        getWalletAddressForCurrency: getWalletAddressForCurrency,
        isWalletDepositLive: isWalletDepositLive,
        getCustomerDisplayAddress: getCustomerDisplayAddress,
        getQrCodePayload: getQrCodePayload,
        getDepositSendLabel: getDepositSendLabel,
        formatDepositCurrencyLabel: formatDepositCurrencyLabel,
        getCryptoAmountForUsd: getCryptoAmountForUsd,
        formatCryptoAmount: formatCryptoAmount,
        inferDepositCurrency: inferDepositCurrency,
        normalizeDepositCurrencyFields: normalizeDepositCurrencyFields
    };
})(typeof window !== "undefined" ? window : globalThis);
