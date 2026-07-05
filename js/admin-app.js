document.addEventListener("DOMContentLoaded", function() {
    const backLink = document.querySelector(".admin-back a");
    if (backLink) backLink.href = getLocalServerUrl("index.html");

    const form = document.getElementById("adminLoginForm");
    if (!form) return;

    const session = getAdminSession();
    const admin = getAdminData();
    if (session && normalizeEmail(session.email) === normalizeEmail(admin.email)) {
        window.location.href = "admin-dashboard.html";
        return;
    }

    form.addEventListener("submit", function(e) {
        e.preventDefault();

        const email = document.getElementById("adminEmail").value.trim();
        const password = document.getElementById("adminPassword").value;

        if (!authenticateAdmin(email, password)) {
            alert("Invalid admin credentials.");
            return;
        }

        setAdminSession(email);
        window.location.href = "admin-dashboard.html";
    });
});
