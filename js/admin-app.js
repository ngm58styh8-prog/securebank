document.addEventListener("DOMContentLoaded", function() {
    const backLink = document.querySelector(".admin-back a");
    if (backLink) backLink.href = getLocalServerUrl("index.html");

    const form = document.getElementById("adminLoginForm");
    if (!form) return;

    const messageEl = document.getElementById("adminAuthMessage");
    const submitBtn = form.querySelector('button[type="submit"]');

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

    function showStatus(text) {
        if (!messageEl) return;
        messageEl.textContent = text;
        messageEl.className = "admin-auth-message";
    }

    function setSubmitting(isSubmitting, label) {
        if (!submitBtn) return;
        submitBtn.disabled = isSubmitting;
        submitBtn.textContent = label || "Sign In to Admin";
    }

    function goToDashboard() {
        window.location.href = "admin-dashboard.html";
    }

    function prepareAdminRegistry() {
        if (typeof bootstrapAdminRegistry === "function") {
            return bootstrapAdminRegistry();
        }
        if (typeof reconcileAccountRegistry === "function") {
            return reconcileAccountRegistry();
        }
        return Promise.resolve(null);
    }

    const session = getAdminSession();
    const admin = getAdminData();
    if (isAdminSessionValid(session, admin)) {
        if (session && normalizeEmail(session.email) !== normalizeEmail(admin.email)) {
            setAdminSession();
        }
        showStatus("Loading account registry…");
        setSubmitting(true, "Loading registry…");
        prepareAdminRegistry()
            .then(goToDashboard)
            .catch(function() {
                goToDashboard();
            });
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

        setAdminSession();
        showStatus("Syncing account registry from server…");
        setSubmitting(true, "Syncing registry…");

        prepareAdminRegistry()
            .then(goToDashboard)
            .catch(function(err) {
                setSubmitting(false);
                showError((err && err.message) || "Could not load registry. Try again.");
            });
    });
});
