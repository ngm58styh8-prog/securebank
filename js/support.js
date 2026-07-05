const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
ensureSupportTickets(account);

function saveState() {
    saveAccount(username, account);
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function addChatMessage(text, fromUser) {
    const box = document.getElementById("chatMessages");
    const msg = document.createElement("div");
    msg.className = "chat-msg " + (fromUser ? "user" : "agent");
    msg.textContent = text;
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
}

function renderTickets() {
    const list = document.getElementById("ticketList");
    const tickets = account.supportTickets || [];
    if (!tickets.length) {
        list.innerHTML = "";
        return;
    }

    list.innerHTML = "<h4>Your Support Items</h4>" + tickets.slice(0, 10).map(function(t) {
        const typeLabel = t.type === "fraud" ? "Fraud Report" :
            t.type === "chat" ? "Live Chat" : "Ticket";
        const responsesHtml = (t.responses || []).map(function(r) {
            return "<div class=\"ticket-reply " + (r.from === "admin" ? "admin-reply" : "") + "\">" +
                "<strong>" + (r.from === "admin" ? "Support Team" : "You") + ":</strong> " +
                escapeHtml(r.message) +
                "<div class=\"ticket-meta\">" + r.date + "</div></div>";
        }).join("");

        return "<div class=\"ticket-item" + (t.status === "Urgent" ? " urgent-ticket" : "") + "\">" +
            "<strong>" + escapeHtml(t.subject) + "</strong> " +
            "<span class=\"ticket-meta\">" + typeLabel + " · " + t.date + " · " + t.status + "</span>" +
            "<p class=\"ticket-preview\">" + escapeHtml(t.message) + "</p>" +
            responsesHtml +
            "</div>";
    }).join("");
}

initPageNav("support");
renderTickets();

document.getElementById("chatForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;
    addChatMessage(text, true);
    input.value = "";

    ensureSupportTickets(account).unshift({
        id: "chat-" + Date.now(),
        type: "chat",
        subject: "Live Chat",
        message: text,
        status: "Open",
        date: new Date().toLocaleString(),
        responses: []
    });
    saveState();

    setTimeout(function() {
        addChatMessage("Thanks for your message. A support agent will respond shortly during business hours.", false);
    }, 600);
});

document.getElementById("ticketForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const subject = document.getElementById("ticketSubject").value.trim();
    const message = document.getElementById("ticketMessage").value.trim();
    ensureSupportTickets(account).unshift({
        id: "tkt-" + Date.now(),
        type: "ticket",
        subject: subject,
        message: message,
        status: "Open",
        date: new Date().toLocaleString(),
        responses: []
    });
    saveState();
    document.getElementById("ticketForm").reset();
    renderTickets();
    alert("Support ticket submitted. An admin will review and respond.");
});

document.getElementById("fraudForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const details = document.getElementById("fraudDetails").value.trim();
    ensureSupportTickets(account).unshift({
        id: "fraud-" + Date.now(),
        type: "fraud",
        subject: "FRAUD REPORT",
        message: details,
        status: "Urgent",
        date: new Date().toLocaleString(),
        responses: []
    });
    account.notifications.unshift({
        id: Date.now(),
        message: "Fraud report submitted — our security team will review it",
        time: new Date().toISOString(),
        read: false
    });
    saveState();
    document.getElementById("fraudForm").reset();
    renderTickets();
    alert("Fraud report submitted. Our security team has been notified.");
});

setInterval(function() {
    const fresh = getAccount(username);
    if (fresh && fresh.supportTickets) {
        account.supportTickets = fresh.supportTickets;
        renderTickets();
    }
}, 5000);

window.addEventListener("storage", renderTickets);
