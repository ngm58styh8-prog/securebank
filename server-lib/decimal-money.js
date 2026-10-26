/**
 * Decimal-safe USD helpers (integer cents).
 */
function toCents(amount) {
    const n = Number(amount);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100);
}

function fromCents(cents) {
    return Number(cents || 0) / 100;
}

function formatUsdFromCents(cents) {
    return fromCents(cents).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/** daily = invested * (percent / 100), e.g. 1% of $1,000 => $10 */
function simulatedDailyReturnCents(investedCents, percentPerDay) {
    const invested = Number(investedCents || 0);
    const pct = Number(percentPerDay || 0);
    if (invested <= 0 || pct <= 0) return 0;
    return Math.round((invested * pct) / 100);
}

function simulatedDailyReturnFixedCents(fixedUsd) {
    return toCents(fixedUsd);
}

module.exports = {
    toCents,
    fromCents,
    formatUsdFromCents,
    simulatedDailyReturnCents,
    simulatedDailyReturnFixedCents
};
