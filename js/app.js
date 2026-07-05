document.addEventListener("DOMContentLoaded", function() {
    const signInForm = document.getElementById("signInForm");
    const signUpForm = document.getElementById("signUpForm");
    const signInTab = document.getElementById("signInTab");
    const signUpTab = document.getElementById("signUpTab");

    if (!signInForm || !signUpForm) return;

    applyWebsiteSettings();

    const ws = getWebsiteSettings();
    if (ws.maintenanceMode) {
        signInForm.querySelectorAll("input, button").forEach(function(el) { el.disabled = true; });
        signUpForm.querySelectorAll("input, button").forEach(function(el) { el.disabled = true; });
        signInTab.disabled = true;
        signUpTab.disabled = true;
    }

    const session = getSession();
    const sessionEmail = session && (session.email || session.username);
    if (sessionEmail && getAccount(sessionEmail)) {
        window.location.href = "dashboard.html";
        return;
    }
    if (sessionEmail) clearSession();

    function showSignIn() {
        signInTab.classList.add("active");
        signUpTab.classList.remove("active");
        signInForm.classList.remove("hidden");
        signUpForm.classList.add("hidden");
    }

    function showSignUp() {
        signUpTab.classList.add("active");
        signInTab.classList.remove("active");
        signUpForm.classList.remove("hidden");
        signInForm.classList.add("hidden");
    }

    signInTab.addEventListener("click", showSignIn);
    signUpTab.addEventListener("click", showSignUp);

    function completeLogin(email) {
        setSession(email);
        const acct = getAccount(email);
        acct.notifications.unshift({
            id: Date.now(),
            message: "Login from " + getDeviceLabel(),
            time: new Date().toISOString(),
            read: false
        });
        saveAccount(email, acct);
        window.location.href = "dashboard.html";
    }

    signInForm.addEventListener("submit", function(e) {
        e.preventDefault();

        const email = normalizeEmail(document.getElementById("signInEmail").value);
        const password = document.getElementById("signInPassword").value;

        if (!isValidEmail(email)) {
            alert("Please enter a valid email address.");
            return;
        }

        if (!authenticate(email, password)) {
            alert("Invalid email or password.");
            return;
        }

        completeLogin(email);
    });

    signUpForm.addEventListener("submit", function(e) {
        e.preventDefault();

        const fullName = document.getElementById("signUpName").value.trim();
        const email = normalizeEmail(document.getElementById("signUpEmail").value);
        const phone = document.getElementById("signUpPhone").value.trim();
        const password = document.getElementById("signUpPassword").value;
        const confirm = document.getElementById("signUpConfirm").value;

        if (!fullName) {
            alert("Please enter your full name.");
            return;
        }

        if (!isValidPhone(phone)) {
            alert("Please enter a valid phone number (at least 10 digits).");
            return;
        }

        if (password !== confirm) {
            alert("Passwords do not match.");
            return;
        }

        const result = createAccount(email, password, fullName, phone);
        if (!result.ok) {
            alert(result.error);
            return;
        }

        sessionStorage.setItem("securebank_new_signup", "1");
        completeLogin(email);
    });
});
