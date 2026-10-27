#!/usr/bin/env node
/**
 * Validates production BTC/ETH deposit addresses and customer wallet resolution.
 * Run: npm run test:deposit-wallets
 */
const assert = require("assert");
const cfg = require("../server-lib/crypto-deposit-config");

const BTC = "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2";
const ETH = "0xC3eFfb72DFE7296e29c386c1C366b42Adb7E857F";

assert.strictEqual(cfg.validateBtcAddress(BTC), true, "BTC format");
assert.strictEqual(cfg.validateEthAddress(ETH), true, "ETH format");
assert.strictEqual(cfg.isAuthorizedProductionAddress("BTC", BTC), true);
assert.strictEqual(cfg.isAuthorizedProductionAddress("ETH", ETH), true);
assert.strictEqual(cfg.isDemoWalletAddress(BTC), false);

const btcWallet = cfg.resolveCustomerDepositWallet(null, "BTC");
const ethWallet = cfg.resolveCustomerDepositWallet(null, "ETH");
assert.strictEqual(btcWallet.address, BTC);
assert.strictEqual(btcWallet.network, "Bitcoin Mainnet");
assert.strictEqual(ethWallet.address, ETH);
assert.strictEqual(ethWallet.network, "Ethereum Mainnet");

const demoAdmin = {
    cryptoDepositWallets: [
        { symbol: "BTC", address: "DEMO-BTC-ADDRESS-DO-NOT-SEND-FUNDS" },
        { symbol: "ETH", address: "DEMO-ETH-ADDRESS-DO-NOT-SEND-FUNDS" }
    ]
};
const sanitized = cfg.normalizeCryptoDepositWallets(demoAdmin);
assert.strictEqual(sanitized.find(function(w) { return w.symbol === "BTC"; }).address, BTC);
assert.strictEqual(sanitized.find(function(w) { return w.symbol === "ETH"; }).address, ETH);

assert.ok(cfg.getNetworkIncompatibilityWarning("BTC").indexOf("Bitcoin Mainnet") !== -1);
assert.ok(cfg.getNetworkIncompatibilityWarning("ETH").indexOf("Ethereum Mainnet") !== -1);

console.log("deposit wallet address tests: 8 passed");
