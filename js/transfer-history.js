const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
const settings = getSettings(account);

let filtered = [];

function formatTransferAmount(amount, currency) {
    currency = String(currency || "USD").toUpperCase();
    amount = Number(amount) || 0;
    if (currency === "USD") return formatMoney(amount, settings.currency);
    if (currency === "BTC") return amount.toFixed(8) + " BTC";
    if (currency === "ETH") return amount.toFixed(6) + " ETH";
    if (currency === "USDT") return amount.toFixed(2) + " USDT";
    return String(amount);
}

function getCounterparty(item) {
    if (item.direction === "sent") {
        return item.recipientEmail || "—";
    }
    return item.senderEmail || "—";
}

function applyFilters() {
    const period = document.getElementById("periodFilter").value;
    const status = document.getElementById("statusFilter").value;
    const query = document.getElementById("searchFilter").value.toLowerCase().trim();

    let history = getSendMoneyHistory(username, { period: period, status: status });

    if (query) {
        history = history.filter(function(item) {
            const hay = [
                item.reference,
                item.senderEmail,
                item.recipientEmail,
                item.note,
                item.method
            ].join(" ").toLowerCase();
            return hay.indexOf(query) !== -1;
        });
    }

    filtered = history;
    renderList();
}

function renderList() {
    const list = document.getElementById("transferList");

    if (!filtered.length) {
        list.innerHTML = '<div class="th-empty">No transfers found. <a href="send-money.html">Send money</a> to get started.</div>';
        return;
    }

    list.innerHTML = filtered.map(function(item) {
        const dir = item.direction || (item.senderEmail === username ? "sent" : "received");
        const counterparty = getCounterparty(Object.assign({}, item, { direction: dir }));
        const date = item.createdAt
            ? new Date(item.createdAt).toLocaleString()
            : (item.date || "—");
        const methodLabel = item.method === "wallet" ? "Wallet" : "Email";
        const sign = dir === "sent" ? "−" : "+";

        return '<div class="th-item ' + dir + '">' +
            '<div>' +
            '<strong>' + (dir === "sent" ? "Sent to " : "Received from ") + counterparty + '</strong>' +
            '<div style="color:var(--muted);font-size:0.85rem;margin-top:6px;">' +
            sign + formatTransferAmount(item.amount, item.currency) +
            ' · ' + methodLabel + ' · Ref ' + (item.reference || "—") +
            '</div>' +
            '<div style="color:var(--muted);font-size:0.8rem;margin-top:4px;">' + date + '</div>' +
            (item.note ? '<div style="font-size:0.85rem;margin-top:6px;">Note: ' + item.note + '</div>' : '') +
            '</div>' +
            '<span class="th-status ' + (item.status || "completed") + '">' + (item.status || "completed") + '</span>' +
            '</div>';
    }).join("");
}

function exportCsv() {
    const rows = [["Date", "Direction", "Counterparty", "Amount", "Currency", "Status", "Reference", "Method", "Note"]];
    filtered.forEach(function(item) {
        const dir = item.direction || (item.senderEmail === username ? "sent" : "received");
        rows.push([
            item.createdAt ? new Date(item.createdAt).toLocaleString() : "",
            dir,
            getCounterparty(Object.assign({}, item, { direction: dir })),
            item.amount,
            item.currency,
            item.status || "completed",
            item.reference || "",
            item.method || "",
            item.note || ""
        ]);
    });

    const csv = rows.map(function(r) {
        return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "globalvest-transfers.csv";
    link.click();
}

function printReceipt() {
    const printArea = document.getElementById("printArea");
    printArea.innerHTML = "<h1>GlobalVest Transfer History</h1><table border='1' cellpadding='8' width='100%'>" +
        "<tr><th>Date</th><th>Direction</th><th>Counterparty</th><th>Amount</th><th>Status</th><th>Reference</th></tr>" +
        filtered.map(function(item) {
            const dir = item.direction || (item.senderEmail === username ? "sent" : "received");
            return "<tr><td>" + (item.createdAt ? new Date(item.createdAt).toLocaleString() : "") +
                "</td><td>" + dir + "</td><td>" + getCounterparty(Object.assign({}, item, { direction: dir })) +
                "</td><td>" + formatTransferAmount(item.amount, item.currency) +
                "</td><td>" + (item.status || "completed") +
                "</td><td>" + (item.reference || "") + "</td></tr>";
        }).join("") + "</table>";

    const win = window.open("", "_blank");
    win.document.write("<html><head><title>Transfer History</title></head><body>" + printArea.innerHTML + "</body></html>");
    win.document.close();
    win.print();
}

initPageNav("transfer-history");
applyFilters();

document.getElementById("periodFilter").addEventListener("change", applyFilters);
document.getElementById("statusFilter").addEventListener("change", applyFilters);
document.getElementById("searchFilter").addEventListener("input", applyFilters);
document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
document.getElementById("printBtn").addEventListener("click", printReceipt);
