"use strict";

const cfg = require("../server-lib/crypto-deposit-config");

const btc = cfg.CRYPTO_DEPOSIT_CONFIG.BTC;
const eth = cfg.CRYPTO_DEPOSIT_CONFIG.ETH;

if (btc.address !== "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2") {
    throw new Error("BTC address mismatch");
}
if (eth.address !== "0xC3eFfb72DFE7296e29c386c1C366b42Adb7E857F") {
    throw new Error("ETH address mismatch");
}
if (btc.enabled !== false || eth.enabled !== false) {
    throw new Error("Deposits must start disabled");
}

if (!cfg.isDemoPlaceholderAddress("DEMO-BTC-ADDRESS-DO-NOT-SEND-FUNDS")) {
    throw new Error("Demo placeholder detection failed");
}

if (!cfg.validateWalletAddress("BTC", btc.address)) {
    throw new Error("BTC validation failed");
}
if (!cfg.validateWalletAddress("ETH", eth.address)) {
    throw new Error("ETH validation failed");
}

const wallets = cfg.normalizeCryptoDepositWallets({});
if (!cfg.isWalletDepositLive(wallets[0])) {
    // expected — not verified/enabled
} else {
    throw new Error("Wallet should not be live by default");
}

const liveBtc = Object.assign({}, wallets[0], { enabled: true, verified: true });
if (!cfg.isWalletDepositLive(liveBtc)) {
    throw new Error("Live wallet check failed when enabled+verified");
}

if (cfg.getQrCodePayload("BTC", btc.address) !== "bitcoin:" + btc.address) {
    throw new Error("BTC QR payload wrong");
}
if (cfg.getQrCodePayload("ETH", eth.address) !== eth.address) {
    throw new Error("ETH QR payload wrong");
}

console.log("crypto deposit config tests: 8 passed");
