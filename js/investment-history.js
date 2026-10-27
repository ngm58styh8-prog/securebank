(function() {
    "use strict";

    function money(n) {
        return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function labelSource(source) {
        if (source === "gold") return "Gold";
        if (source === "simulation") return "Investments";
        return source || "—";
    }

    function labelEvent(type) {
        if (type === "simulated-credit") return "Earnings credit";
        if (type === "gold-credit") return "Earnings credit";
        return type || "—";
    }

    function load() {
        var user = requireAuth();
        if (!user) return;
        var filter = document.getElementById("invHistFilter").value;
        fetchCustomerInvestmentHistory(user, filter).then(function(r) {
            var body = document.getElementById("invHistBody");
            if (!body) return;
            if (!r.ok || !r.events || !r.events.length) {
                body.innerHTML = "<tr><td colspan=\"6\">No history for this filter.</td></tr>";
                return;
            }
            body.innerHTML = r.events.map(function(ev) {
                return "<tr><td>" + new Date(ev.date).toLocaleString() + "</td><td>" + labelSource(ev.source) +
                    "</td><td>" + (ev.assetName || ev.assetId) + "</td><td>" + labelEvent(ev.type) +
                    "</td><td>" + money(ev.amount) + "</td><td>" + (ev.reference || "—") + "</td></tr>";
            }).join("");
        });
    }

    document.addEventListener("DOMContentLoaded", function() {
        document.getElementById("invHistRefresh").addEventListener("click", load);
        document.getElementById("invHistFilter").addEventListener("change", load);
        load();
    });
})();
