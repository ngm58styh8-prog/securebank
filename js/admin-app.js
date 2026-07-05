document.addEventListener("DOMContentLoaded", function() {
    const backLink = document.querySelector(".admin-back a");
    if (backLink) backLink.href = getLocalServerUrl("index.html");

    const form = document.getElementById("adminLoginForm");
    if (!form) return;

    const messageEl = document.getElementById("adminAuthMessage");

    function showError(text) {
        if (!messageEl) return;
        messageEl.textContent = text;
        messageEl.className = "admin-auth-message error";
    }

    function clearError() {
        if (!messageEl) return;
        messageEl.textContent = "";
        messageEl.className = "admin-auth-message";
    }

    const session = getAdminSession();
    const admin = getAdminData();
    if (session && normalizeEmail(session.email) === normalizeEmail(admin.email)) {
        window.location.href = "admin-dashboard.html";
        return;
    }

    form.addEventListener("submit", function(e) {
        e.preventDefault();
        clearError();

        const email = document.getElementById("adminEmail").value.trim();
        const password = document.getElementById("adminPassword").value;

        if (!email || !password) {
            showError("Please enter your admin email and password.");
            return;
        }

        if (!authenticateAdmin(email, password)) {
            showError("Invalid admin email or password.");
            return;
        }

        setAdminSession(email);
        window.location.href = "admin-dashboard.html";
    });
});
