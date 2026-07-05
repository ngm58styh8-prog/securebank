const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
ensureSupportTickets(account);

function saveState() {
    saveAccount(username, account);
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
    list.innerHTML = "<h4>Your Tickets</h4>" + tickets.slice(0, 5).map(function(t) {
        return "<div class=\"ticket-item\"><strong>" + t.subject + "</strong><br><span class=\"ticket-meta\">" +
            t.date + " · " + t.status + "</span></div>";
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
    setTimeout(function() {
        addChatMessage("Thanks for your message. A support agent will respond shortly during business hours.", false);
    }, 600);
});

document.getElementById("ticketForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const subject = document.getElementById("ticketSubject").value.trim();
    const message = document.getElementById("ticketMessage").value.trim();
    ensureSupportTickets(account).unshift({
        id: Date.now(),
        subject: subject,
        message: message,
        status: "Open",
        date: new Date().toLocaleString()
    });
    saveState();
    document.getElementById("ticketForm").reset();
    renderTickets();
    alert("Support ticket submitted. We'll respond via email.");
});

document.getElementById("fraudForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const details = document.getElementById("fraudDetails").value.trim();
    ensureSupportTickets(account).unshift({
        id: Date.now(),
        subject: "FRAUD REPORT",
        message: details,
        status: "Urgent",
        date: new Date().toLocaleString()
    });
    account.notifications.unshift({
        id: Date.now(),
        message: "Fraud report submitted — our security team will review it",
        time: new Date().toISOString(),
        read: false
    });
    saveState();
    document.getElementById("fraudForm").reset();
    alert("Fraud report submitted. Our security team has been notified.");
});
