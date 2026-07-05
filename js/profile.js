const username = requireAuth();
if (!username) throw new Error("Not authenticated");

const account = getAccount(username);
ensureSettings(username, account);
const profile = ensureProfile(username, account);

function getInitials(name) {
    return name
        .split(" ")
        .map(function(part) { return part.charAt(0); })
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function formatMemberSince(isoDate) {
    return new Date(isoDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function renderProfile() {
    document.getElementById("profileAvatar").textContent = getInitials(profile.fullName);
    document.getElementById("profileFullName").textContent = profile.fullName;
    document.getElementById("displayFullName").textContent = profile.fullName;
    document.getElementById("displayEmail").textContent = profile.email;
    document.getElementById("displayPhone").textContent = profile.phone || "—";
    document.getElementById("displayMemberSince").textContent = formatMemberSince(profile.memberSince);
    document.getElementById("displayVerification").textContent = profile.verificationStatus;

    const badge = document.getElementById("verificationBadge");
    const isVerified = profile.verificationStatus === "Verified";
    badge.textContent = isVerified ? "✓ Verified" : "⏳ Pending";
    badge.className = "verification-badge " + (isVerified ? "verified" : "pending");

    renderVerificationSection();
    renderEmailInbox();
}

function renderVerificationSection() {
    const isVerified = profile.verificationStatus === "Verified" && profile.ssnLast4;
    const banner = document.getElementById("verificationBanner");
    const ssnForm = document.getElementById("kyc");
    const ssnVerified = document.getElementById("ssnVerifiedCard");

    if (banner) banner.classList.toggle("hidden", isVerified);
    if (ssnForm) ssnForm.classList.toggle("hidden", isVerified);
    if (ssnVerified) {
        ssnVerified.classList.toggle("hidden", !isVerified);
        document.getElementById("displaySsn").textContent = formatSsnDisplay(profile.ssnLast4);
    }
}

function renderEmailInbox() {
    const inbox = document.getElementById("emailInbox");
    if (!inbox) return;

    const emails = account.emails || [];
    if (!emails.length) {
        inbox.innerHTML = '<p class="email-empty">No emails yet.</p>';
        return;
    }

    inbox.innerHTML = emails.map(function(email) {
        const preview = email.body.split("\n")[0];
        return `<div class="email-item ${email.read ? "" : "unread"}" data-email-id="${email.id}">
            <div class="email-item-header">
                <strong>${email.subject}</strong>
                <span class="email-time">${new Date(email.time).toLocaleString()}</span>
            </div>
            <div class="email-meta">To: ${email.to}</div>
            <div class="email-preview">${preview}</div>
            <div class="email-body hidden">${email.body.replace(/\n/g, "<br>")}</div>
        </div>`;
    }).join("");

    inbox.querySelectorAll(".email-item").forEach(function(item) {
        item.addEventListener("click", function() {
            const body = item.querySelector(".email-body");
            const preview = item.querySelector(".email-preview");
            const isOpen = !body.classList.contains("hidden");
            body.classList.toggle("hidden", isOpen);
            preview.classList.toggle("hidden", !isOpen);
            item.classList.remove("unread");

            const emailId = item.dataset.emailId;
            const email = (account.emails || []).find(function(e) { return String(e.id) === emailId; });
            if (email) email.read = true;
            saveAccount(username, account);
        });
    });
}

function formatSsnInput(value) {
    const digits = value.replace(/\D/g, "").slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return digits.slice(0, 3) + "-" + digits.slice(3);
    return digits.slice(0, 3) + "-" + digits.slice(3, 5) + "-" + digits.slice(5);
}

function submitSsnForm(e) {
    e.preventDefault();

    const ssn = document.getElementById("ssnInput").value;
    const result = submitSsnVerification(username, ssn);
    if (!result.ok) {
        alert(result.error);
        return;
    }

    Object.assign(profile, account.profile);
    document.getElementById("ssnInput").value = "";
    renderProfile();
    alert("Identity verified successfully! You now have full access to your account.");
}

function applyTheme(theme) {
    account.theme = theme;
    if (account.settings) account.settings.theme = theme;
    applyThemeToDocument(theme);
    saveAccount(username, account);
}

function openEditModal() {
    document.getElementById("editFullName").value = profile.fullName;
    document.getElementById("editEmail").value = profile.email;
    document.getElementById("editPhone").value = profile.phone;
    document.getElementById("editOverlay").classList.remove("hidden");
}

function closeEditModal() {
    document.getElementById("editOverlay").classList.add("hidden");
}

function saveProfile(e) {
    e.preventDefault();

    profile.fullName = document.getElementById("editFullName").value.trim();
    profile.email = document.getElementById("editEmail").value.trim();
    profile.phone = document.getElementById("editPhone").value.trim();

    if (!isValidPhone(profile.phone)) {
        alert("Please enter a valid phone number (at least 10 digits).");
        return;
    }

    account.profile = profile;
    saveAccount(username, account);
    renderProfile();
    closeEditModal();
}

function logout() {
    clearSession();
    window.location.href = "index.html";
}

initPageNav("profile");
renderProfile();

document.getElementById("editProfileBtn").addEventListener("click", openEditModal);
document.getElementById("cancelEditBtn").addEventListener("click", closeEditModal);
document.getElementById("editProfileForm").addEventListener("submit", saveProfile);
document.getElementById("ssnVerificationForm").addEventListener("submit", submitSsnForm);

const ssnInput = document.getElementById("ssnInput");
if (ssnInput) {
    ssnInput.addEventListener("input", function() {
        ssnInput.value = formatSsnInput(ssnInput.value);
    });
}
document.getElementById("themeToggle").addEventListener("click", function() {
    applyTheme(account.theme === "dark" ? "light" : "dark");
});
document.getElementById("logoutBtn").addEventListener("click", logout);

document.getElementById("editOverlay").addEventListener("click", function(e) {
    if (e.target === document.getElementById("editOverlay")) {
        closeEditModal();
    }
});
