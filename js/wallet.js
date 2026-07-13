const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
const settings = getSettings(account);

const PAGE_SIZE = 10;
let currentPage = 1;
let filtered = [];

function classifyTransaction(t) {
    const d = t.description.toLowerCase();
    if (d.includes("deposit")) return "deposit";
    if (d.includes("send money") || d.includes("funds received")) return "transfer";
    if (d.includes("withdraw") || d.includes("transfer request")) return "withdraw";
    if (d.includes("gold")) return "gold";
    if (d.includes("spy") || d.includes("qqq") || d.includes("vti")) return "investment";
    if (d.includes("aapl") || d.includes("googl") || d.includes("msft") || d.includes("nvda")) return "stock";
    if (d.includes("buy")) return "buy";
    if (d.includes("sell")) return "sell";
    return "other";
}

function applyFilters() {
    const query = document.getElementById("searchInput").value.toLowerCase().trim();
    const filter = document.getElementById("filterSelect").value;

    filtered = account.transactions.filter(function(t) {
        const matchSearch = !query ||
            t.description.toLowerCase().includes(query) ||
            t.date.toLowerCase().includes(query);
        const matchFilter = filter === "all" || classifyTransaction(t) === filter;
        return matchSearch && matchFilter;
    });

    currentPage = 1;
    renderPage();
}

function renderPage() {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);
    const tbody = document.getElementById("walletBody");

    if (!pageItems.length) {
        tbody.innerHTML = '<tr><td colspan="3">No transactions found.</td></tr>';
    } else {
        tbody.innerHTML = pageItems.map(function(t) {
            const sign = t.amount < 0 ? "-" : "+";
            return `<tr>
                <td>${t.date}</td>
                <td>${t.description}</td>
                <td>${sign}${formatMoney(Math.abs(t.amount), settings.currency)}</td>
            </tr>`;
        }).join("");
    }

    document.getElementById("pageInfo").textContent =
        "Page " + currentPage + " of " + totalPages + " (" + filtered.length + " total)";
    document.getElementById("prevPageBtn").disabled = currentPage <= 1;
    document.getElementById("nextPageBtn").disabled = currentPage >= totalPages;
}

function exportCsv() {
    const rows = [["Date", "Description", "Amount"]];
    filtered.forEach(function(t) {
        rows.push([t.date, t.description, t.amount]);
    });
    const csv = rows.map(function(r) {
        return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "globalvest-transactions.csv";
    link.click();
}

function exportPdf() {
    const printArea = document.getElementById("printArea");
    printArea.innerHTML = "<h1>GlobalVest Transactions</h1><table border='1' cellpadding='8' cellspacing='0' width='100%'><tr><th>Date</th><th>Description</th><th>Amount</th></tr>" +
        filtered.map(function(t) {
            const sign = t.amount < 0 ? "-" : "+";
            return "<tr><td>" + t.date + "</td><td>" + t.description + "</td><td>" +
                sign + formatMoney(Math.abs(t.amount), settings.currency) + "</td></tr>";
        }).join("") + "</table>";

    const win = window.open("", "_blank");
    win.document.write("<html><head><title>GlobalVest Transactions</title></head><body>" + printArea.innerHTML + "</body></html>");
    win.document.close();
    win.print();
}

initPageNav("wallet");
applyFilters();

document.getElementById("searchInput").addEventListener("input", applyFilters);
document.getElementById("filterSelect").addEventListener("change", applyFilters);
document.getElementById("prevPageBtn").addEventListener("click", function() {
    if (currentPage > 1) { currentPage--; renderPage(); }
});
document.getElementById("nextPageBtn").addEventListener("click", function() {
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (currentPage < totalPages) { currentPage++; renderPage(); }
});
document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
document.getElementById("exportPdfBtn").addEventListener("click", exportPdf);
document.getElementById("themeToggle").addEventListener("click", function() {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    account.theme = settings.theme;
    account.settings = settings;
    applyThemeToDocument(settings.theme);
    saveAccount(username, account);
});
