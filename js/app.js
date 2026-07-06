document.addEventListener("DOMContentLoaded", function() {
    const signInForm = document.getElementById("signInForm");
    const signUpForm = document.getElementById("signUpForm");
    const signInTab = document.getElementById("signInTab");
    const signUpTab = document.getElementById("signUpTab");
    const twoFactorStep = document.getElementById("twoFactorStep");
    const emailVerifyStep = document.getElementById("emailVerifyStep");

    if (!signInForm || !signUpForm) return;

    let pendingLoginEmail = null;
    let pendingSignupEmail = null;

    applyWebsiteSettings();

    initAuthTheme();
    initPasswordToggles();
    initFieldValidation();
    initLivePrices();
    loadRememberedEmail();

    const ws = getWebsiteSettings();
    if (ws.maintenanceMode) {
        disableAuthForms(true);
    }

    const session = getSession();
    const sessionEmail = session && (session.email || session.username);
    if (sessionEmail && getAccount(sessionEmail)) {
        window.location.href = "dashboard.html";
        return;
    }
    if (sessionEmail) clearSession();

    function disableAuthForms(disabled) {
        signInForm.querySelectorAll("input, button, select").forEach(function(el) { el.disabled = disabled; });
        signUpForm.querySelectorAll("input, button, select").forEach(function(el) { el.disabled = disabled; });
        signInTab.disabled = disabled;
        signUpTab.disabled = disabled;
    }

    function showPanel(panel) {
        [signInForm, signUpForm, twoFactorStep, emailVerifyStep].forEach(function(el) {
            if (!el) return;
            el.classList.add("auth-panel-hidden");
            el.classList.remove("auth-panel-visible");
        });
        if (panel) {
            panel.classList.remove("auth-panel-hidden");
            panel.classList.add("auth-panel-visible");
        }
    }

    function showSignIn() {
        signInTab.classList.add("active");
        signUpTab.classList.remove("active");
        signInTab.setAttribute("aria-selected", "true");
        signUpTab.setAttribute("aria-selected", "false");
        showPanel(signInForm);
        updateLastLoginBanner();
    }

    function showSignUp() {
        signUpTab.classList.add("active");
        signInTab.classList.remove("active");
        signUpTab.setAttribute("aria-selected", "true");
        signInTab.setAttribute("aria-selected", "false");
        showPanel(signUpForm);
        updateSignupProgress();
    }

    signInTab.addEventListener("click", showSignIn);
    signUpTab.addEventListener("click", showSignUp);

    const landingTab = sessionStorage.getItem("securebank_auth_tab");
    if (landingTab === "signup") {
        showSignUp();
    } else if (landingTab === "signin") {
        showSignIn();
    }
    sessionStorage.removeItem("securebank_auth_tab");
    sessionStorage.removeItem("securebank_page_transition");

    initSocialAuth();

    function showMessage(el, text, type) {
        if (!el) return;
        el.textContent = text;
        el.classList.remove("hidden", "error", "success");
        el.classList.add(type || "error");
    }

    function hideMessage(el) {
        if (el) el.classList.add("hidden");
    }

    function finalizeLogin(email) {
        const loginMeta = recordSuccessfulLogin(email);
        setSession(email);

        if (document.getElementById("rememberMe").checked) {
            localStorage.setItem("securebank_remember_email", normalizeEmail(email));
        } else {
            localStorage.removeItem("securebank_remember_email");
        }

        sessionStorage.setItem("securebank_new_signup", pendingSignupEmail === email ? "1" : "");
        pendingLoginEmail = null;
        pendingSignupEmail = null;
        window.location.href = "dashboard.html";
    }

    function beginLoginFlow(email) {
        const account = getAccount(email);
        const settings = getSettings(account);

        pendingLoginEmail = email;

        const newDeviceAlert = document.getElementById("newDeviceAlert");
        const fingerprint = getDeviceFingerprint();
        const knownDevices = account.knownDevices || [];
        if (knownDevices.indexOf(fingerprint) === -1 && knownDevices.length > 0) {
            newDeviceAlert.textContent = "You're signing in from a new device (" + getDeviceLabel() + "). We'll notify your account.";
            newDeviceAlert.classList.remove("hidden");
        } else {
            newDeviceAlert.classList.add("hidden");
        }

        if (settings.twoFactorEnabled) {
            document.getElementById("twoFactorCode").value = "";
            hideMessage(document.getElementById("twoFactorMessage"));
            showPanel(twoFactorStep);
            return;
        }

        finalizeLogin(email);
    }

    function updateLastLoginBanner() {
        const banner = document.getElementById("lastLoginBanner");
        const email = normalizeEmail(document.getElementById("signInEmail").value);
        if (!email || !isValidEmail(email)) {
            banner.classList.add("hidden");
            return;
        }
        const account = getAccount(email);
        if (!account || !account.profile || !account.profile.lastLoginAt) {
            banner.classList.add("hidden");
            return;
        }
        banner.textContent = "Last login: " + formatAuthDateTime(account.profile.lastLoginAt) +
            (account.profile.lastLoginDevice ? " from " + account.profile.lastLoginDevice : "");
        banner.classList.remove("hidden");
    }

    document.getElementById("signInEmail").addEventListener("blur", updateLastLoginBanner);

    signInForm.addEventListener("submit", function(e) {
        e.preventDefault();
        hideMessage(document.getElementById("signInMessage"));

        const email = normalizeEmail(document.getElementById("signInEmail").value);
        const password = document.getElementById("signInPassword").value;

        if (!isValidEmail(email)) {
            showMessage(document.getElementById("signInMessage"), "Please enter a valid email address.", "error");
            return;
        }

        if (!authenticate(email, password)) {
            showMessage(document.getElementById("signInMessage"), "Invalid email or password.", "error");
            return;
        }

        const account = getAccount(email);
        if (account.emailVerified === false) {
            pendingSignupEmail = email;
            pendingLoginEmail = email;
            document.getElementById("emailVerifyDesc").textContent =
                "Your email is not verified yet. Enter the 6-digit code we sent to " + email + ".";
            document.getElementById("emailVerifyCode").value = "";
            hideMessage(document.getElementById("emailVerifyMessage"));
            showPanel(emailVerifyStep);
            return;
        }

        beginLoginFlow(email);
    });

    document.getElementById("twoFactorSubmit").addEventListener("click", function() {
        const code = document.getElementById("twoFactorCode").value.trim();
        const account = pendingLoginEmail ? getAccount(pendingLoginEmail) : null;
        if (!account) {
            showSignIn();
            return;
        }
        if (!verifyTwoFactorCode(account, code)) {
            showMessage(document.getElementById("twoFactorMessage"), "Invalid authentication code.", "error");
            return;
        }
        finalizeLogin(pendingLoginEmail);
    });

    document.getElementById("twoFactorBack").addEventListener("click", function() {
        pendingLoginEmail = null;
        showSignIn();
    });

    document.getElementById("emailVerifySubmit").addEventListener("click", function() {
        const email = pendingSignupEmail || pendingLoginEmail;
        const code = document.getElementById("emailVerifyCode").value.trim();
        const result = verifyEmailCode(email, code);
        if (!result.ok) {
            showMessage(document.getElementById("emailVerifyMessage"), result.error, "error");
            return;
        }
        showMessage(document.getElementById("emailVerifyMessage"), "Email verified! Signing you in…", "success");
        setTimeout(function() {
            if (pendingLoginEmail && getSettings(getAccount(pendingLoginEmail)).twoFactorEnabled) {
                beginLoginFlow(pendingLoginEmail);
            } else {
                finalizeLogin(email);
            }
        }, 600);
    });

    signUpForm.addEventListener("submit", function(e) {
        e.preventDefault();
        hideMessage(document.getElementById("signUpMessage"));

        const fullName = document.getElementById("signUpName").value.trim();
        const email = normalizeEmail(document.getElementById("signUpEmail").value);
        const phone = document.getElementById("signUpPhone").value.trim();
        const country = document.getElementById("signUpCountry").value;
        const password = document.getElementById("signUpPassword").value;
        const confirm = document.getElementById("signUpConfirm").value;
        const agreedToTerms = document.getElementById("signUpTerms").checked;

        if (!fullName) {
            showMessage(document.getElementById("signUpMessage"), "Please enter your full name.", "error");
            return;
        }

        if (!country) {
            showMessage(document.getElementById("signUpMessage"), "Please select your country.", "error");
            return;
        }

        if (password !== confirm) {
            showMessage(document.getElementById("signUpMessage"), "Passwords do not match.", "error");
            return;
        }

        const result = createAccount(email, password, fullName, phone, {
            country: country,
            dateOfBirth: "",
            referralCode: "",
            currency: "USD",
            agreedToTerms: agreedToTerms
        });

        if (!result.ok) {
            showMessage(document.getElementById("signUpMessage"), result.error, "error");
            return;
        }

        pendingSignupEmail = email;
        pendingLoginEmail = email;
        document.getElementById("emailVerifyDesc").textContent =
            "We sent a 6-digit code to " + email + ". Check your inbox to continue.";
        document.getElementById("emailVerifyCode").value = "";
        hideMessage(document.getElementById("emailVerifyMessage"));
        showPanel(emailVerifyStep);
    });

    document.getElementById("forgotPasswordBtn").addEventListener("click", function() {
        document.getElementById("forgotModal").classList.remove("hidden");
        document.getElementById("forgotEmail").value = document.getElementById("signInEmail").value;
        hideMessage(document.getElementById("forgotMessage"));
    });

    document.getElementById("forgotCancel").addEventListener("click", closeForgotModal);
    document.getElementById("forgotModalBackdrop").addEventListener("click", closeForgotModal);

    document.getElementById("forgotSubmit").addEventListener("click", function() {
        const email = normalizeEmail(document.getElementById("forgotEmail").value);
        const result = requestPasswordReset(email);
        if (!result.ok) {
            showMessage(document.getElementById("forgotMessage"), result.error, "error");
            return;
        }
        showMessage(document.getElementById("forgotMessage"), result.message, "success");
    });

    document.getElementById("termsLink").addEventListener("click", function(e) {
        e.preventDefault();
        alert("GlobalVest Terms of Service — by creating an account you agree to our terms of use and acceptable use policy.");
    });

    document.getElementById("privacyLink").addEventListener("click", function(e) {
        e.preventDefault();
        alert("GlobalVest Privacy Policy — we protect your personal data with bank-grade encryption and never sell your information.");
    });

    document.getElementById("signUpPassword").addEventListener("input", updatePasswordStrength);
    signUpForm.addEventListener("input", updateSignupProgress);
    document.getElementById("signUpTerms").addEventListener("change", updateSignupProgress);
    updateSignupProgress();

    function closeForgotModal() {
        document.getElementById("forgotModal").classList.add("hidden");
    }

    function loadRememberedEmail() {
        const saved = localStorage.getItem("securebank_remember_email");
        if (saved) {
            document.getElementById("signInEmail").value = saved;
            document.getElementById("signInEmail").dispatchEvent(new Event("input"));
            updateLastLoginBanner();
        }
    }
});

function initAuthTheme() {
    const toggle = document.getElementById("authThemeToggle");
    const saved = localStorage.getItem("securebank_auth_theme") || "light";
    applyAuthTheme(saved);

    if (toggle) {
        toggle.addEventListener("click", function() {
            const next = document.body.dataset.theme === "dark" ? "light" : "dark";
            applyAuthTheme(next);
            localStorage.setItem("securebank_auth_theme", next);
        });
    }
}

function applyAuthTheme(theme) {
    document.body.dataset.theme = theme === "dark" ? "dark" : "";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0a0e17" : "#0059b3";
    const toggle = document.getElementById("authThemeToggle");
    if (toggle) toggle.textContent = theme === "dark" ? "☀️" : "🌙";
}

function initPasswordToggles() {
    document.querySelectorAll(".pwd-toggle").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.textContent = show ? "🙈" : "👁";
            btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        });
    });
}

function initFieldValidation() {
    document.querySelectorAll(".float-field").forEach(function(wrap) {
        const input = wrap.querySelector("input, select");
        if (!input) return;

        function validate() {
            let valid = false;
            const id = input.id;

            if (id === "signUpEmail" || id === "signInEmail") {
                valid = isValidEmail(normalizeEmail(input.value));
            } else if (id === "signUpPhone") {
                valid = isValidPhone(input.value);
            } else if (id === "signUpPassword") {
                valid = input.value.length >= 6;
            } else if (id === "signUpConfirm") {
                const pw = document.getElementById("signUpPassword");
                valid = input.value.length >= 6 && pw && input.value === pw.value;
            } else if (input.tagName === "SELECT") {
                valid = !!input.value;
            } else if (input.type === "checkbox") {
                valid = input.checked;
            } else {
                valid = input.value.trim().length > 0;
            }

            wrap.classList.toggle("is-valid", valid && input.value !== "");
        }

        input.addEventListener("input", validate);
        input.addEventListener("blur", validate);
        input.addEventListener("change", validate);
    });
}

function updatePasswordStrength() {
    const password = document.getElementById("signUpPassword").value;
    const fill = document.getElementById("passwordStrengthFill");
    const label = document.getElementById("passwordStrengthLabel");
    if (!fill || !label) return;

    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const levels = [
        { pct: 0, text: "Password strength", color: "transparent" },
        { pct: 25, text: "Weak", color: "#c0392b" },
        { pct: 50, text: "Fair", color: "#e67e22" },
        { pct: 75, text: "Good", color: "#f1c40f" },
        { pct: 100, text: "Strong", color: "#1a8f4c" }
    ];

    const level = password.length === 0 ? levels[0] : levels[Math.min(score, 4)];
    fill.style.width = level.pct + "%";
    fill.style.background = level.color;
    label.textContent = level.text;
}

function updateSignupProgress() {
    const fields = [
        "signUpName", "signUpEmail", "signUpPhone", "signUpCountry",
        "signUpPassword", "signUpConfirm"
    ];
    let filled = 0;
    fields.forEach(function(id) {
        const el = document.getElementById(id);
        if (el && el.value && String(el.value).trim()) filled++;
    });
    if (document.getElementById("signUpTerms").checked) filled++;

    const total = fields.length + 1;
    const pct = Math.round((filled / total) * 100);
    const bar = document.getElementById("signupProgressBar");
    const label = document.getElementById("signupProgressLabel");
    if (bar) bar.style.width = pct + "%";
    if (label) label.textContent = pct + "% complete";
}

function initSocialAuth() {
    function bindSocial(id) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener("click", function() {
            alert("Social sign-in is not available yet. Please use email and password.");
        });
    }
    bindSocial("googleSignIn");
    bindSocial("appleSignIn");
    bindSocial("googleSignUp");
    bindSocial("appleSignUp");
}

async function initLivePrices() {
    const btcEl = document.getElementById("liveBtc");
    const ethEl = document.getElementById("liveEth");
    if (!btcEl || !ethEl) return;

    try {
        const response = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true"
        );
        if (!response.ok) throw new Error("price fetch failed");
        const data = await response.json();

        if (data.bitcoin) {
            btcEl.textContent = "$" + data.bitcoin.usd.toLocaleString(undefined, { maximumFractionDigits: 0 });
        }
        if (data.ethereum) {
            ethEl.textContent = "$" + data.ethereum.usd.toLocaleString(undefined, { maximumFractionDigits: 0 });
        }
    } catch (e) {
        btcEl.textContent = "$97,250";
        ethEl.textContent = "$3,420";
    }
}
