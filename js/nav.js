function initPageNav(activePage) {
    const nav = document.getElementById("mainNav");
    if (!nav) return;

    nav.querySelectorAll(".nav-link").forEach(function(link) {
        link.classList.toggle("active", link.dataset.page === activePage);
    });

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && !logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "1";
        logoutBtn.addEventListener("click", function() {
            clearSession();
            window.location.href = "login.html";
        });
    }

    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle && !themeToggle.dataset.bound) {
        themeToggle.dataset.bound = "1";
        themeToggle.addEventListener("click", function() {
            const session = getSession();
            const email = session && (session.email || session.username);
            if (!email) return;
            const account = getAccount(email);
            if (!account) return;
            ensureSettings(email, account);
            const next = account.settings.theme === "dark" ? "light" : "dark";
            account.settings.theme = next;
            account.theme = next;
            saveAccount(email, account);
            applyThemeToDocument(next);
        });
    }
}

function applyUserTheme() {
    const session = getSession();
    const email = session && (session.email || session.username);
    if (!email) return;
    const account = getAccount(email);
    if (!account) return;
    ensureSettings(email, account);
    applyThemeToDocument(account.settings.theme || account.theme || "light");
}

applyUserTheme();
