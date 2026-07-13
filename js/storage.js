const SESSION_KEY = "securebank_session";
const ACCOUNTS_KEY = "securebank_accounts";
const ADMIN_DATA_KEY = "securebank_admin_data";
const ADMIN_SESSION_KEY = "securebank_admin_session";
const DELETED_ACCOUNTS_KEY = "securebank_deleted_accounts";

let serverAccountsCache = {};

const REGISTRY_API_FALLBACKS = [
    "https://globalvestbank.com",
    "https://securebank-1.vercel.app"
];

let resolvedRegistryApiOrigin = null;
let registryOriginPromise = null;

function getRegistryApiOrigin() {
    if (resolvedRegistryApiOrigin) return resolvedRegistryApiOrigin;
    if (typeof window === "undefined") return "";
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        return window.location.origin;
    }
    return REGISTRY_API_FALLBACKS[0];
}

function registryApiUrl(path) {
    const origin = getRegistryApiOrigin();
    const normalizedPath = path.charAt(0) === "/" ? path : "/" + path;
    if (!origin) return normalizedPath;
    return origin.replace(/\/$/, "") + normalizedPath;
}

function resolveRegistryApiOrigin() {
    if (resolvedRegistryApiOrigin) {
        return Promise.resolve(resolvedRegistryApiOrigin);
    }
    if (registryOriginPromise) return registryOriginPromise;

    registryOriginPromise = Promise.resolve().then(function() {
        if (typeof window === "undefined") {
            resolvedRegistryApiOrigin = "";
            return "";
        }

        const meta = document.querySelector('meta[name="globalvest-registry-api"]');
        if (meta && meta.content) {
            resolvedRegistryApiOrigin = String(meta.content).trim().replace(/\/$/, "");
            return resolvedRegistryApiOrigin;
        }

        const current = window.location.origin;
        if (current && (current.indexOf("http://") === 0 || current.indexOf("https://") === 0)) {
            resolvedRegistryApiOrigin = current;
            return current;
        }

        resolvedRegistryApiOrigin = REGISTRY_API_FALLBACKS[0];
        return resolvedRegistryApiOrigin;
    });

    return registryOriginPromise;
}

function fetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    return new Promise(function(resolve, reject) {
        const timer = setTimeout(function() {
            reject(new Error("Registry request timed out."));
        }, timeoutMs);

        fetch(url, options || {})
            .then(function(response) {
                clearTimeout(timer);
                resolve(response);
            })
            .catch(function(err) {
                clearTimeout(timer);
                reject(err);
            });
    });
}

function registryFetch(path, options) {
    return resolveRegistryApiOrigin().then(function() {
        return fetchWithTimeout(registryApiUrl(path), options || {}, 15000);
    });
}

function bootstrapAdminRegistry() {
    return resolveRegistryApiOrigin()
        .then(function() { return pullAccountsFromServer(); })
        .then(function(pullResult) {
            if (typeof pullAdminFromServer === "function") {
                return pullAdminFromServer().then(function() {
                    return pullResult;
                });
            }
            return pullResult;
        })
        .then(function() {
            repairAccountsStorage();
            linkAccountPendingDepositsToAdmin();
            syncAdminRegisteredUsers(getAdminData());
            return { ok: true, pendingDeposits: getPendingDeposits().length };
        })
        .catch(function(err) {
            return { ok: false, error: String(err) };
        });
}

function setServerAccountsCache(accounts) {
    serverAccountsCache = accounts && typeof accounts === "object" && !Array.isArray(accounts)
        ? accounts
        : {};
}

function getServerAccountsCache() {
    return serverAccountsCache;
}

function getDeletedAccountMarks() {
    try {
        const data = JSON.parse(localStorage.getItem(DELETED_ACCOUNTS_KEY));
        return data && typeof data === "object" ? data : {};
    } catch (e) {
        return {};
    }
}

function markAccountDeleted(email) {
    const key = normalizeEmail(email);
    if (!key) return;
    const marks = getDeletedAccountMarks();
    marks[key] = new Date().toISOString();
    localStorage.setItem(DELETED_ACCOUNTS_KEY, JSON.stringify(marks));
}

function clearAccountDeletedMark(email) {
    const key = normalizeEmail(email);
    if (!key) return;
    const marks = getDeletedAccountMarks();
    if (!marks[key]) return;
    delete marks[key];
    localStorage.setItem(DELETED_ACCOUNTS_KEY, JSON.stringify(marks));
}

function isAccountDeletedMark(email) {
    return !!getDeletedAccountMarks()[normalizeEmail(email)];
}

function parseRegistrySyncTime(value) {
    const time = Date.parse(value || "");
    return isNaN(time) ? 0 : time;
}

function getMergedAccountsRegistry() {
    const merged = {};
    const local = getAllAccounts();
    const server = getServerAccountsCache();

    Object.keys(local).forEach(function(email) {
        const key = normalizeEmail(email);
        if (!key) return;
        merged[key] = local[email];
    });

    Object.keys(server).forEach(function(email) {
        const key = normalizeEmail(email);
        const serverAcct = server[email];
        if (!key || !serverAcct || typeof serverAcct !== "object") return;
        if (isAccountDeletedMark(key)) return;
        if (merged[key]) {
            merged[key] = mergeAccountRecords(serverAcct, merged[key]);
        } else {
            merged[key] = serverAcct;
        }
    });

    return merged;
}

function persistMergedRegistryToLocal() {
    const merged = getMergedAccountsRegistry();
    const keys = Object.keys(merged);
    if (!keys.length) return false;

    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(merged));
    notifyAccountsChanged();
    syncAdminRegisteredUsers(getAdminData());
    return true;
}

function getRegistryAccount(email) {
    const key = findAccountKey(email) || normalizeEmail(email);
    const merged = getMergedAccountsRegistry();
    return merged[key] || null;
}

function linkAllAccountsToAdmin() {
    const admin = syncAdminRegisteredUsers(getAdminData());
    saveAdminData(admin);
    return {
        linkedCount: Object.keys(admin.registeredUsers || {}).length,
        accountCount: Object.keys(getMergedAccountsRegistry()).length
    };
}

const DEFAULT_ADMIN = {
    email: "admin@globalvest.com",
    password: "admin123",
    balance: 0,
    payments: [],
    pendingTransfers: [],
    pendingDeposits: [],
    walletAddress: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
    bankDetails: "GlobalVest Admin · Routing: 021000021 · Account: 8847291053"
};

const DEPOSIT_METHODS = {
    crypto: { enabled: true, label: "Bitcoin (BTC)" },
    bank: { enabled: false, label: "Bank Transfer", unavailable: "Bank transfers are unavailable at the moment." },
    card: { enabled: false, label: "Visa / Card", unavailable: "Visa and card payments are unavailable at the moment." }
};

const FX_RATES = { USD: 1, EUR: 0.92, GBP: 0.79 };

const DEFAULT_WEBSITE_SETTINGS = {
    siteName: "GlobalVest",
    siteTagline: "Global Investing & Digital Banking",
    supportEmail: "support@globalvest.com",
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
    btc: 0.4825, eth: 8.16, sol: 8.5, xrp: 1250, usdt: 0,
    gold: 1.5,
    aapl: 12, googl: 6, msft: 10, nvda: 8,
    spy: 20, qqq: 15, vti: 25
};

const SEND_MONEY_CURRENCIES = ["USD", "BTC", "ETH", "USDT"];
const SEND_MONEY_HOLDING_KEYS = { BTC: "btc", ETH: "eth", USDT: "usdt" };

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
        subject: "Verify your GlobalVest email",
        body: "Hi " + fullName + ",\n\n" +
            "Thanks for signing up! Enter this verification code to activate your account:\n\n" +
            code + "\n\n" +
            "This code expires in 24 hours. If you did not create an account, ignore this email.\n\n" +
            "GlobalVest Security Team",
        type: "verification"
    });
}

function verifyEmailCode(email, code) {
    if (typeof markEmailVerifiedLocally === "function") {
        return verifyEmailCodeLocalFallback(email, code);
    }
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

function verifyEmailCodeLocalFallback(email, code) {
    const key = normalizeEmail(email);
    const account = getAccount(key);
    if (!account) return { ok: false, error: "Account not found." };
    if (account.emailVerified) return { ok: true };
    const expected = String(account.emailVerificationCode || "").trim();
    if (!expected || String(code || "").trim() !== expected) {
        return { ok: false, error: "Invalid verification code." };
    }
    return markEmailVerifiedLocally(key);
}

function sendPasswordResetEmail(account, email) {
    const profile = account.profile || {};
    queueAccountEmail(account, {
        to: email,
        subject: "GlobalVest password reset",
        body: "Hi " + (profile.fullName || email) + ",\n\n" +
            "We received a request to reset your password. In this demo, use your existing password or contact support.\n\n" +
            "If you did not request this, you can safely ignore this message.\n\n" +
            "GlobalVest Security Team",
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
    saveAccount(key, account, { eventType: "login" });
    recordAdminUserEvent(key, "login", "Signed in from " + deviceLabel, 0);

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
        subject: "Welcome to GlobalVest!",
        body: "Hi " + fullName + ",\n\n" +
            "Welcome to GlobalVest! Your account has been created successfully.\n\n" +
            "You now have access to secure online banking, crypto trading, and portfolio management. " +
            "Your account starts with a $0 balance — use Deposit to add funds when you're ready.\n\n" +
            "Before you can access all features, please complete identity verification by submitting " +
            "your Social Security Number (SSN) in your profile settings.\n\n" +
            "If you did not create this account, please contact us immediately at support@globalvest.com.\n\n" +
            "Thank you for choosing GlobalVest,\nThe GlobalVest Team",
        type: "welcome"
    });
}

function sendSsnVerificationEmail(account, email, fullName) {
    queueAccountEmail(account, {
        to: email,
        subject: "Action Required: Verify Your Identity",
        body: "Hi " + fullName + ",\n\n" +
            "To comply with federal banking regulations and protect your account, we need to verify your identity.\n\n" +
            "Please log in to GlobalVest and go to Profile → Identity Verification to submit your " +
            "Social Security Number (SSN).\n\n" +
            "Your SSN is encrypted and used solely for identity verification. We never share your " +
            "personal information with third parties.\n\n" +
            "Until verification is complete, some account features may be limited.\n\n" +
            "Complete verification here: Profile → Identity Verification\n\n" +
            "GlobalVest Security Team",
        type: "verification"
    });
}

function formatDepositMethod(method) {
    if (method === "crypto") return "Cryptocurrency";
    if (method === "bank") return "Bank Transfer";
    if (method === "card") return "Card";
    return method || "Deposit";
}

function formatWithdrawalMethod(method) {
    if (method === "crypto") return "Cryptocurrency";
    if (method === "bank") return "Bank Transfer";
    return method || "Transfer";
}

function getTransactionEmailMeta(account, userEmail) {
    const ws = getWebsiteSettings();
    const profile = account.profile || {};
    return {
        siteName: ws.siteName || "GlobalVest",
        supportEmail: ws.supportEmail || "support@globalvest.com",
        fullName: profile.fullName || userEmail
    };
}

function dispatchAccountEmail(account, userEmail, subject, body, type) {
    queueAccountEmail(account, {
        to: userEmail,
        subject: subject,
        body: body,
        type: type || "general"
    });
    if (typeof sendRealEmail !== "function") {
        return Promise.resolve({ ok: false, error: "Email service unavailable." });
    }
    return sendRealEmail(userEmail, subject, body, { category: type || "general" });
}

function sendDepositSubmittedEmail(account, userEmail, amount, method, payTo) {
    const meta = getTransactionEmailMeta(account, userEmail);
    const methodLabel = formatDepositMethod(method);
    const subject = meta.siteName + " — Deposit request received ($" + amount.toFixed(2) + ")";
    let body = "Hi " + meta.fullName + ",\n\n" +
        "We received your deposit request for $" + amount.toFixed(2) + " via " + methodLabel + ".\n\n" +
        "Status: Pending admin approval\n" +
        "Submitted: " + new Date().toLocaleString() + "\n\n";
    if (method === "crypto" && payTo) {
        body += "Send your payment to this address:\n" + payTo + "\n\n";
    }
    body += "You will receive another email once your deposit is approved and credited.\n\n" +
        "Questions? Contact " + meta.supportEmail + ".\n\n" +
        "Thank you,\n" + meta.siteName;
    return dispatchAccountEmail(account, userEmail, subject, body, "deposit");
}

function sendDepositApprovedEmail(account, userEmail, amount, method) {
    const meta = getTransactionEmailMeta(account, userEmail);
    const methodLabel = formatDepositMethod(method);
    const subject = meta.siteName + " — Deposit of $" + amount.toFixed(2) + " credited";
    const body = "Hi " + meta.fullName + ",\n\n" +
        "Your deposit of $" + amount.toFixed(2) + " via " + methodLabel +
        " has been approved and credited to your account.\n\n" +
        "Updated cash balance: $" + Number(account.cash).toFixed(2) + "\n" +
        "Date: " + new Date().toLocaleString() + "\n\n" +
        "Log in to GlobalVest to view your updated balance and transaction history.\n\n" +
        "If you did not make this deposit, contact us immediately at " + meta.supportEmail + ".\n\n" +
        "Thank you,\n" + meta.siteName;
    return dispatchAccountEmail(account, userEmail, subject, body, "deposit");
}

function sendDepositRejectedEmail(account, userEmail, amount, method, reason) {
    const meta = getTransactionEmailMeta(account, userEmail);
    const methodLabel = formatDepositMethod(method);
    const subject = meta.siteName + " — Deposit request declined ($" + amount.toFixed(2) + ")";
    const body = "Hi " + meta.fullName + ",\n\n" +
        "Your deposit request for $" + amount.toFixed(2) + " via " + methodLabel +
        " was not approved.\n\n" +
        (reason ? "Reason: " + reason + "\n\n" : "") +
        "No funds were added to your account. If you believe this was a mistake, contact " +
        meta.supportEmail + ".\n\n" +
        "Thank you,\n" + meta.siteName;
    return dispatchAccountEmail(account, userEmail, subject, body, "deposit");
}

function sendWithdrawalSubmittedEmail(account, userEmail, amount, destination, method) {
    const meta = getTransactionEmailMeta(account, userEmail);
    const methodLabel = formatWithdrawalMethod(method);
    const subject = meta.siteName + " — Withdrawal request received ($" + amount.toFixed(2) + ")";
    const body = "Hi " + meta.fullName + ",\n\n" +
        "We received your withdrawal request for $" + amount.toFixed(2) + " via " + methodLabel +
        " to " + (destination || "your linked account") + ".\n\n" +
        "Status: Pending admin approval\n" +
        "Submitted: " + new Date().toLocaleString() + "\n\n" +
        "You will receive another email once your withdrawal is processed.\n\n" +
        "If you did not submit this request, contact us immediately at " + meta.supportEmail + ".\n\n" +
        "Thank you,\n" + meta.siteName;
    return dispatchAccountEmail(account, userEmail, subject, body, "withdrawal");
}

function sendWithdrawalApprovedEmail(account, userEmail, amount, destination, method) {
    const meta = getTransactionEmailMeta(account, userEmail);
    const methodLabel = formatWithdrawalMethod(method);
    const subject = meta.siteName + " — Withdrawal of $" + amount.toFixed(2) + " processed";
    const body = "Hi " + meta.fullName + ",\n\n" +
        "Your withdrawal of $" + amount.toFixed(2) + " via " + methodLabel +
        " to " + (destination || "your linked account") + " has been approved and processed.\n\n" +
        "Updated cash balance: $" + Number(account.cash).toFixed(2) + "\n" +
        "Date: " + new Date().toLocaleString() + "\n\n" +
        "Log in to GlobalVest to view your transaction history.\n\n" +
        "If you did not authorize this withdrawal, contact us immediately at " + meta.supportEmail + ".\n\n" +
        "Thank you,\n" + meta.siteName;
    return dispatchAccountEmail(account, userEmail, subject, body, "withdrawal");
}

function sendWithdrawalRejectedEmail(account, userEmail, amount, destination, reason) {
    const meta = getTransactionEmailMeta(account, userEmail);
    const subject = meta.siteName + " — Withdrawal request declined ($" + amount.toFixed(2) + ")";
    const body = "Hi " + meta.fullName + ",\n\n" +
        "Your withdrawal request for $" + amount.toFixed(2) +
        " to " + (destination || "your linked account") + " was not approved.\n\n" +
        (reason ? "Reason: " + reason + "\n\n" : "") +
        "Your balance was not changed. If you have questions, contact " + meta.supportEmail + ".\n\n" +
        "Thank you,\n" + meta.siteName;
    return dispatchAccountEmail(account, userEmail, subject, body, "withdrawal");
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
            "You now have full access to all GlobalVest features including transfers, deposits, and trading.\n\n" +
            "GlobalVest Security Team",
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
            message: "Welcome to GlobalVest! A welcome email was sent to " + email,
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

function isCompleteAccount(account) {
    return !!(account &&
        typeof account === "object" &&
        account.password &&
        account.profile &&
        typeof account.profile === "object");
}

function findAccountKey(email) {
    const target = normalizeEmail(email);
    if (!target) return null;

    const accounts = getAllAccountsUncached();
    if (accounts[target]) return target;

    return Object.keys(accounts).find(function(key) {
        return normalizeEmail(key) === target;
    }) || null;
}

function getAllAccountsUncached() {
    try {
        const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return {};
        }

        const normalized = {};
        Object.keys(raw).forEach(function(key) {
            const entry = raw[key];
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
            const emailKey = normalizeEmail(key);
            if (!emailKey || !isValidEmail(emailKey)) return;
            if (normalized[emailKey]) {
                normalized[emailKey] = Object.assign({}, normalized[emailKey], entry);
            } else {
                normalized[emailKey] = entry;
            }
        });
        return normalized;
    } catch (e) {
        return {};
    }
}

function repairAccountsStorage(options) {
    options = options || {};
    const report = {
        repaired: [],
        removed: [],
        merged: [],
        incomplete: []
    };

    let raw;
    try {
        raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
    } catch (e) {
        raw = null;
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        if (raw != null) {
            localStorage.removeItem(ACCOUNTS_KEY);
            report.removed.push("(invalid registry root)");
            notifyAccountsChanged();
        }
        return report;
    }

    const accounts = {};
    let changed = false;

    Object.keys(raw).forEach(function(key) {
        let entry = raw[key];
        const emailKey = normalizeEmail(key);

        if (!emailKey || !isValidEmail(emailKey)) {
            report.removed.push(String(key));
            changed = true;
            return;
        }

        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            report.removed.push(emailKey);
            changed = true;
            return;
        }

        if (accounts[emailKey]) {
            entry = Object.assign({}, accounts[emailKey], entry);
            report.merged.push(emailKey);
            changed = true;
        }

        if (!entry.profile || typeof entry.profile !== "object") {
            entry.profile = getDefaultProfile(
                emailKey,
                entry.profile && entry.profile.fullName ? entry.profile.fullName : null
            );
            report.repaired.push(emailKey + ":profile");
            changed = true;
        } else if (!entry.profile.email) {
            entry.profile.email = emailKey;
            report.repaired.push(emailKey + ":profile-email");
            changed = true;
        }

        if (ensureHoldings(entry)) {
            report.repaired.push(emailKey + ":holdings");
            changed = true;
        }
        ensureNotifications(entry);

        if (!entry.settings) {
            entry.settings = {
                theme: entry.theme || "light",
                currency: "USD",
                language: "en",
                twoFactorEnabled: false
            };
            report.repaired.push(emailKey + ":settings");
            changed = true;
        }

        if (!entry.analytics) {
            entry.analytics = {
                dayStartDate: null,
                dayStartValue: null,
                monthStartMonth: null,
                monthStartValue: null
            };
            report.repaired.push(emailKey + ":analytics");
            changed = true;
        }

        if (!isCompleteAccount(entry)) {
            report.incomplete.push(emailKey);
        }

        accounts[emailKey] = entry;
        if (emailKey !== key) changed = true;
    });

    if (changed) {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
        notifyAccountsChanged();
        syncAdminRegisteredUsers(getAdminData());
    }

    return report;
}

function diagnoseAccountEmail(email) {
    const key = normalizeEmail(email);
    const accountKey = findAccountKey(key);
    const merged = typeof getMergedAccountsRegistry === "function"
        ? getMergedAccountsRegistry()
        : getAllAccountsUncached();
    const account = accountKey
        ? merged[normalizeEmail(accountKey)]
        : (merged[key] || null);

    return {
        query: key,
        origin: typeof window !== "undefined" ? window.location.origin : "unknown",
        canonical: typeof isCanonicalAppOrigin === "function" ? isCanonicalAppOrigin() : true,
        found: !!account,
        accountKey: accountKey || (merged[key] ? key : null),
        complete: isCompleteAccount(account),
        hasPassword: !!(account && account.password),
        hasProfile: !!(account && account.profile),
        profileName: account && account.profile ? account.profile.fullName : null,
        registeredCount: Object.keys(merged).length,
        onServer: !!(typeof getServerAccountsCache === "function" && getServerAccountsCache()[key])
    };
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
        const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return {};
        }

        const normalized = {};
        let changed = false;

        Object.keys(raw).forEach(function(key) {
            const entry = raw[key];
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
            const emailKey = normalizeEmail(key);
            if (!emailKey || !isValidEmail(emailKey)) return;
            if (normalized[emailKey]) {
                normalized[emailKey] = Object.assign({}, normalized[emailKey], entry);
            } else {
                normalized[emailKey] = entry;
            }
            if (emailKey !== key) changed = true;
        });

        if (changed) {
            localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(normalized));
            notifyAccountsChanged();
        }

        return normalized;
    } catch (e) {
        return {};
    }
}

function getRegisteredAccountCount() {
    return Object.keys(getMergedAccountsRegistry()).length;
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
    const key = findAccountKey(email) || normalizeEmail(email);
    const accounts = getAllAccounts();
    let account = accounts[key];

    if (!account) {
        const serverAcct = getServerAccountsCache()[key];
        if (serverAcct && typeof serverAcct === "object") {
            account = serverAcct;
            accounts[key] = account;
            localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
            notifyAccountsChanged();
            syncAdminRegisteredUsers(getAdminData());
        }
    }

    if (!account) return null;
    ensureNotifications(account);
    if (ensureHoldings(account)) {
        accounts[key] = account;
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }
    if (!account.profile || typeof account.profile !== "object") {
        account.profile = getDefaultProfile(key);
        accounts[key] = account;
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
        notifyAccountsChanged();
    }
    return account;
}

function accountExists(email) {
    const account = getAccount(email);
    return isCompleteAccount(account);
}

function accountStubExists(email) {
    const key = findAccountKey(email);
    return !!key;
}

function createAccount(email, password, fullName, phone, extras) {
    extras = extras || {};
    repairAccountsStorage();
    const key = normalizeEmail(email);
    if (!isValidEmail(key)) {
        return { ok: false, error: "Please enter a valid email address." };
    }

    const existing = getAccount(key);
    if (existing && isCompleteAccount(existing)) {
        return {
            ok: false,
            error: "An account with this email already exists. Please sign in instead.",
            existing: true
        };
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
    account.emailVerificationCode = null;
    account.knownDevices = [];
    account.settings = {
        theme: "light",
        currency: extras.currency || "USD",
        language: "en",
        twoFactorEnabled: false
    };
    sendWelcomeEmail(account, key, fullName.trim());
    sendSsnVerificationEmail(account, key, fullName.trim());
    saveAccount(key, account, { skipServerSync: true });
    recordAdminUserEvent(key, "signup", "New account registered", 0);
    syncAdminRegisteredUsers(getAdminData());
    return { ok: true, email: key };
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

function pushAccountNotification(account, message, options) {
    options = options || {};
    if (!account || !message) return ensureNotifications(account);
    ensureNotifications(account);
    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: message,
        time: options.time || new Date().toISOString(),
        read: false,
        type: options.type || null,
        fromAdmin: !!options.fromAdmin
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }
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

function saveAccount(email, account, options) {
    options = options || {};
    const accounts = getAllAccounts();
    const key = findAccountKey(email) || normalizeEmail(email);
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
    notifyAccountsChanged();
    syncAdminRegisteredUsers(getAdminData());
    if (options.skipServerSync !== true) {
        syncAccountToServer(key, account, options.eventType || "signup");
    }
}

function notifyAccountsChanged() {
    if (typeof window === "undefined") return;
    try {
        window.dispatchEvent(new CustomEvent("globalvest-accounts-changed", {
            detail: { key: ACCOUNTS_KEY }
        }));
    } catch (e) { /* ignore */ }
}

function isServerSyncAvailable() {
    if (typeof window === "undefined") return false;
    return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function mergeAccountRecords(serverAcct, localAcct) {
    if (!serverAcct) return localAcct;
    if (!localAcct) return serverAcct;

    const localSynced = parseRegistrySyncTime(localAcct.serverSyncedAt);
    const serverSynced = parseRegistrySyncTime(serverAcct.serverSyncedAt);
    const serverIsNewer = serverSynced >= localSynced;

    const merged = Object.assign({}, serverAcct, localAcct);
    merged.profile = Object.assign({}, serverAcct.profile || {}, localAcct.profile || {});
    merged.settings = Object.assign({}, serverAcct.settings || {}, localAcct.settings || {});
    merged.holdings = Object.assign({}, serverAcct.holdings || {}, localAcct.holdings || {});
    merged.notifications = mergeNotificationLists(
        localAcct.notifications || [],
        serverAcct.notifications || []
    );

    const localTx = localAcct.transactions || [];
    const serverTx = serverAcct.transactions || [];
    if (serverIsNewer || serverTx.length > localTx.length) {
        merged.transactions = serverTx.length ? serverTx : localTx;
    } else {
        merged.transactions = localTx.length ? localTx : serverTx;
    }

    if (typeof serverAcct.cash === "number" && !isNaN(serverAcct.cash)) {
        if (typeof localAcct.cash !== "number" || isNaN(localAcct.cash)) {
            merged.cash = serverAcct.cash;
        } else if (serverIsNewer || serverAcct.cash > localAcct.cash) {
            merged.cash = serverAcct.cash;
        } else {
            merged.cash = localAcct.cash;
        }
    } else if (typeof localAcct.cash === "number" && !isNaN(localAcct.cash)) {
        merged.cash = localAcct.cash;
    }

    merged.serverSyncedAt = serverIsNewer
        ? (serverAcct.serverSyncedAt || localAcct.serverSyncedAt)
        : (localAcct.serverSyncedAt || serverAcct.serverSyncedAt);

    merged.password = localAcct.password || serverAcct.password;
    merged.emailVerified = localAcct.emailVerified != null ? localAcct.emailVerified : serverAcct.emailVerified;
    if (localAcct.withdrawalsFrozen != null) merged.withdrawalsFrozen = localAcct.withdrawalsFrozen;
    else if (serverAcct.withdrawalsFrozen != null) merged.withdrawalsFrozen = serverAcct.withdrawalsFrozen;
    merged.withdrawalsFrozenReason = localAcct.withdrawalsFrozenReason || serverAcct.withdrawalsFrozenReason || "";
    merged.withdrawalsFrozenAt = localAcct.withdrawalsFrozenAt || serverAcct.withdrawalsFrozenAt || null;
    return merged;
}

function normalizeRegistryEventType(eventType) {
    if (eventType === "login") return "login";
    if (eventType === "admin-adjust") return "admin-adjust";
    if (eventType === "deposit-approve") return "deposit-approve";
    if (eventType === "deposit-submit") return "deposit-submit";
    return "signup";
}

function applyServerAccountLocally(email, serverAccount) {
    if (!serverAccount || typeof serverAccount !== "object") return null;
    const key = normalizeEmail(email);
    const accounts = getAllAccounts();
    const localKey = findAccountKey(key) || key;
    const merged = mergeAccountRecords(serverAccount, accounts[localKey] || serverAccount);
    accounts[localKey] = merged;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    notifyAccountsChanged();
    const cache = Object.assign({}, getServerAccountsCache());
    cache[key] = serverAccount;
    setServerAccountsCache(cache);
    return merged;
}

function syncAccountToServer(email, account, eventType) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, offline: true });
    }

    if (!account) {
        account = getAccount(email);
    }
    if (!account) {
        return Promise.resolve({ ok: false, error: "Account not found." });
    }

    const key = normalizeEmail(email);
    return registryFetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: key,
            account: account,
            eventType: normalizeRegistryEventType(eventType)
        })
    })
        .then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok || !data.ok) {
                    return {
                        ok: false,
                        error: data.error || "Server sync failed.",
                        status: response.status
                    };
                }
                if (data.account) {
                    applyServerAccountLocally(key, data.account);
                } else {
                    const cache = getServerAccountsCache();
                    cache[key] = account;
                    setServerAccountsCache(cache);
                }
                syncAdminRegisteredUsers(getAdminData());
                if (
                    typeof pullAdminFromServer === "function" &&
                    eventType !== "admin-adjust" &&
                    eventType !== "deposit-approve"
                ) {
                    return pullAdminFromServer().then(function() {
                        return data;
                    });
                }
                return data;
            });
        })
        .catch(function(err) {
            return { ok: false, error: String(err) };
        });
}

function syncRegistrationToServer(email, account, eventType) {
    return syncAccountToServer(email, account, eventType || "signup").then(function(result) {
        if (result.ok) {
            syncAdminRegisteredUsers(getAdminData());
            if (typeof pullAdminFromServer === "function") {
                return pullAdminFromServer().then(function() {
                    return result;
                });
            }
        }
        return result;
    });
}

function deleteAccountFromServer(email) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, offline: true });
    }

    const key = normalizeEmail(email);
    return registryFetch("/api/accounts?email=" + encodeURIComponent(key), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: key })
    })
        .then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok || !data.ok) {
                    return {
                        ok: false,
                        error: (data && data.error) || "Could not delete account on server."
                    };
                }
                return data;
            });
        })
        .catch(function(err) {
            return { ok: false, error: err.message || "Could not delete account on server." };
        });
}

function removeAccountEverywhere(email) {
    const key = normalizeEmail(email);
    const accounts = getAllAccounts();
    delete accounts[key];
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));

    const cache = Object.assign({}, getServerAccountsCache());
    delete cache[key];
    setServerAccountsCache(cache);
    notifyAccountsChanged();
}

function pullAccountsFromServer() {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, accounts: {} });
    }

    return registryFetch("/api/accounts", { cache: "no-store" })
        .then(function(response) {
            if (!response.ok) throw new Error("Registry unavailable");
            return response.json();
        })
        .then(function(payload) {
            if (!payload.ok || !payload.accounts) {
                return { ok: false, accounts: {} };
            }

            const serverAccounts = payload.accounts;
            setServerAccountsCache(serverAccounts);
            const local = getAllAccounts();
            let changed = false;

            Object.keys(serverAccounts).forEach(function(email) {
                const key = normalizeEmail(email);
                const serverAcct = serverAccounts[email];
                if (!key || !serverAcct || typeof serverAcct !== "object") return;
                if (isAccountDeletedMark(key)) return;

                clearAccountDeletedMark(key);
                const localKey = findAccountKey(key) || key;
                if (local[localKey]) {
                    const merged = mergeAccountRecords(serverAcct, local[localKey]);
                    if (JSON.stringify(merged) !== JSON.stringify(local[localKey])) {
                        local[localKey] = merged;
                        changed = true;
                    }
                } else {
                    local[key] = serverAcct;
                    changed = true;
                }
            });

            Object.keys(local).forEach(function(email) {
                const key = normalizeEmail(email);
                if (isProtectedAdminAccount(key)) return;
                if (serverAccounts[key] || serverAccounts[email]) return;
                if (!isAccountDeletedMark(key)) return;
                delete local[email];
                changed = true;
            });

            if (changed) {
                localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(local));
                notifyAccountsChanged();
            }

            syncAdminRegisteredUsers(getAdminData());

            return { ok: true, accounts: serverAccounts, merged: changed, count: payload.count || 0 };
        })
        .catch(function(err) {
            syncAdminRegisteredUsers(getAdminData());
            return { ok: false, accounts: {}, error: String(err) };
        });
}

function reconcileAccountRegistry(options) {
    options = options || {};
    repairAccountsStorage();
    syncAdminRegisteredUsers(getAdminData());

    if (!isServerSyncAvailable()) {
        return Promise.resolve({
            ok: true,
            offline: true,
            localCount: getRegisteredAccountCount(),
            linkedCount: Object.keys(getAdminData().registeredUsers || {}).length
        });
    }

    const adminPullOnly = options.adminPullOnly === true || (isAdminPanelPage() && options.fullSync !== true);
    const pullOnly = options.fullSync !== true;

    return resolveRegistryApiOrigin().then(function() {
        return pullAccountsFromServer();
    })
        .then(function(pullResult) {
            if (typeof pullAdminFromServer === "function") {
                return pullAdminFromServer().then(function() {
                    linkAccountPendingDepositsToAdmin();
                    return pullResult;
                });
            }
            linkAccountPendingDepositsToAdmin();
            return pullResult;
        })
        .then(function(pullResult) {
            if (adminPullOnly || pullOnly) {
                return syncOrphanAccountDepositsToAdmin().then(function(repairResult) {
                    return {
                        pull: pullResult,
                        import: { ok: true, imported: 0, skipped: true },
                        secondPull: pullResult,
                        pullOnly: true,
                        repair: repairResult,
                        pendingDeposits: getPendingDeposits().length
                    };
                });
            }

            return importLocalAccountsToServer().then(function(importResult) {
                return pullAccountsFromServer().then(function(secondPull) {
                    return importLocalAdminToServer().then(function() {
                        return {
                            pull: pullResult,
                            import: importResult,
                            secondPull: secondPull
                        };
                    });
                });
            });
        })
        .then(function(result) {
            const report = repairAccountsStorage();
            if (!adminPullOnly) {
                persistMergedRegistryToLocal();
            }
            linkAccountPendingDepositsToAdmin();
            const admin = syncAdminRegisteredUsers(getAdminData());
            if (!adminPullOnly) {
                saveAdminData(admin);
            }
            return {
                ok: true,
                localCount: getRegisteredAccountCount(),
                linkedCount: Object.keys(admin.registeredUsers || {}).length,
                serverCount: result.secondPull && result.secondPull.count != null
                    ? result.secondPull.count
                    : (result.pull && result.pull.count != null ? result.pull.count : null),
                imported: result.import && result.import.imported != null ? result.import.imported : 0,
                report: report,
                registryError: result.pull && !result.pull.ok ? result.pull.error : null,
                pendingDeposits: getPendingDeposits().length
            };
        })
        .catch(function(err) {
            const report = repairAccountsStorage();
            const admin = syncAdminRegisteredUsers(getAdminData());
            if (!adminPullOnly) {
                saveAdminData(admin);
            }
            return {
                ok: false,
                error: String(err),
                localCount: getRegisteredAccountCount(),
                linkedCount: Object.keys(admin.registeredUsers || {}).length,
                report: report
            };
        });
}

function applyPendingDepositToLocalRegistry(deposit, pendingDeposits) {
    const admin = getAdminData();
    if (Array.isArray(pendingDeposits)) {
        admin.pendingDeposits = pendingDeposits.slice();
    } else if (deposit) {
        if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];
        const exists = admin.pendingDeposits.some(function(entry) {
            return String(entry.id) === String(deposit.id);
        });
        if (!exists) {
            admin.pendingDeposits.unshift(Object.assign({}, deposit));
        }
    }
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
    return admin;
}

function syncOrphanAccountDepositsToAdmin() {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: true, synced: 0, offline: true });
    }

    const admin = getAdminData();
    const adminIds = {};
    (admin.pendingDeposits || []).forEach(function(entry) {
        if (entry && entry.id != null) {
            adminIds[String(entry.id)] = true;
        }
    });

    const orphans = getPendingDepositsFromAccounts().filter(function(dep) {
        return dep && dep.id != null && !adminIds[String(dep.id)];
    });

    if (!orphans.length) {
        return Promise.resolve({ ok: true, synced: 0 });
    }

    return Promise.all(orphans.map(function(dep) {
        return appendPendingDepositOnServer(dep);
    })).then(function() {
        return pullAdminFromServer();
    }).then(function() {
        return { ok: true, synced: orphans.length };
    }).catch(function(err) {
        return { ok: false, synced: 0, error: err.message || String(err) };
    });
}

function refreshUnifiedRegistry(options) {
    options = options || {};

    return resolveRegistryApiOrigin().then(function() {
        return Promise.all([
            pullAccountsFromServer(),
            pullAdminFromServer()
        ]);
    }).then(function() {
        linkAccountPendingDepositsToAdmin();
        if (options.repairDeposits !== false) {
            return syncOrphanAccountDepositsToAdmin();
        }
        return { ok: true, synced: 0 };
    }).then(function(repairResult) {
        syncAdminRegisteredUsers(getAdminData());
        return {
            ok: true,
            pendingDeposits: getPendingDeposits().length,
            accountCount: Object.keys(getMergedAccountsRegistry()).length,
            repair: repairResult
        };
    }).catch(function(err) {
        return { ok: false, error: String(err) };
    });
}

function reconcileAdminQueues() {
    return refreshUnifiedRegistry({ repairDeposits: true });
}

function importLocalAccountsToServer() {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, imported: 0 });
    }

    const local = getAllAccounts();
    const emails = Object.keys(local);
    if (!emails.length) {
        return Promise.resolve({ ok: true, imported: 0 });
    }

    return Promise.all(emails.map(function(email) {
        return syncAccountToServer(email, local[email]);
    })).then(function() {
        return { ok: true, imported: emails.length };
    });
}

function checkRegistryHealth() {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, configured: false, offline: true });
    }

    return registryFetch("/api/registry-health", { cache: "no-store" })
        .then(function(response) { return response.json(); })
        .then(function(payload) {
            payload = payload || {};
            return {
                ok: !!payload.ok,
                configured: !!payload.configured,
                tableReady: payload.tableReady !== false,
                message: payload.message || "",
                tableError: payload.tableError || null
            };
        })
        .catch(function() {
            return { ok: false, configured: false, tableReady: false };
        });
}

function syncAdminToServer(admin) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, offline: true });
    }

    return registryFetch("/api/admin-data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin: admin })
    })
        .then(function(response) { return response.json(); })
        .catch(function() { return { ok: false }; });
}

function pullAdminFromServer() {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false });
    }

    return registryFetch("/api/admin-data", { cache: "no-store" })
        .then(function(response) {
            if (!response.ok) throw new Error("Admin registry unavailable");
            return response.json();
        })
        .then(function(payload) {
            if (!payload.ok || !payload.admin || !payload.admin.email) {
                return { ok: false };
            }

            const admin = ensureAdminDataShape(migrateAdminBranding(payload.admin));
            mergeServerAdminLocally(admin);
            linkAccountPendingDepositsToAdmin();
            syncAdminRegisteredUsers(getAdminData());
            return { ok: true, admin: admin };
        })
        .catch(function() {
            return { ok: false };
        });
}

function importLocalAdminToServer() {
    if (!isServerSyncAvailable() || isAdminPanelPage()) {
        return Promise.resolve({ ok: false, skipped: true });
    }

    let local;
    try {
        local = JSON.parse(localStorage.getItem(ADMIN_DATA_KEY));
    } catch (e) {
        local = null;
    }

    if (!local || !local.email) {
        return Promise.resolve({ ok: false });
    }

    return syncAdminToServer(ensureAdminDataShape(local));
}

function syncCurrentUserToServer(email) {
    if (!email || !isServerSyncAvailable()) return;
    const account = getAccount(email);
    if (!account || !isCompleteAccount(account)) return;
    syncAccountToServer(email, account, "login");
}

function requireAuth() {
    repairAccountsStorage();
    const session = getSession();
    const email = session && (session.email || session.username);
    if (!email) {
        window.location.href = "login.html";
        return null;
    }
    const account = getAccount(email);
    if (!account || !isCompleteAccount(account)) {
        clearSession();
        window.location.href = "login.html";
        return null;
    }
    const key = normalizeEmail(email);
    syncCurrentUserToServer(key);
    return key;
}

function isLegacyAdminEmail(email) {
    return normalizeEmail(email) === normalizeEmail("admin@" + "secure" + "bank" + ".com");
}

function isProtectedAdminAccount(email) {
    const key = normalizeEmail(email);
    return isLegacyAdminEmail(key) || key === normalizeEmail(DEFAULT_ADMIN.email);
}

function getManageableUsersSummary() {
    return getAllUsersSummary().filter(function(u) {
        return !isProtectedAdminAccount(u.email);
    });
}

function migrateAdminBranding(data) {
    let changed = false;
    if (isLegacyAdminEmail(data.email)) {
        data.email = DEFAULT_ADMIN.email;
        changed = true;
    }
    if (data.bankDetails && data.bankDetails.indexOf("Secure" + "Bank") !== -1) {
        data.bankDetails = DEFAULT_ADMIN.bankDetails;
        changed = true;
    }
    if (data.websiteSettings) {
        const legacySite = "Secure" + "Bank";
        if (data.websiteSettings.siteName === legacySite) {
            data.websiteSettings.siteName = DEFAULT_WEBSITE_SETTINGS.siteName;
            changed = true;
        }
        const legacySupport = "support@" + "secure" + "bank" + ".com";
        if (data.websiteSettings.supportEmail === legacySupport) {
            data.websiteSettings.supportEmail = DEFAULT_WEBSITE_SETTINGS.supportEmail;
            changed = true;
        }
        if (data.websiteSettings.siteTagline === "Secure Online Banking") {
            data.websiteSettings.siteTagline = DEFAULT_WEBSITE_SETTINGS.siteTagline;
            changed = true;
        }
    }
    if (changed) saveAdminData(data);
    return data;
}

function isAdminSessionValid(session, admin) {
    if (!session || !session.email || !admin || !admin.email) return false;
    const sessionEmail = normalizeEmail(session.email);
    const adminEmail = normalizeEmail(admin.email);
    return sessionEmail === adminEmail || isLegacyAdminEmail(sessionEmail);
}

function ensureAdminDataShape(data) {
    if (!data.pendingTransfers) data.pendingTransfers = [];
    if (!data.pendingDeposits) data.pendingDeposits = [];
    if (!data.payments) data.payments = [];
    if (typeof data.balance !== "number" || isNaN(data.balance)) data.balance = 0;
    if (!data.password) data.password = DEFAULT_ADMIN.password;
    if (!data.walletAddress) data.walletAddress = DEFAULT_ADMIN.walletAddress;
    if (data.walletAddress === "bc1qsecurebank0ff1c1aladm1nwalle7demo2024") {
        data.walletAddress = DEFAULT_ADMIN.walletAddress;
    }
    if (!data.bankDetails) data.bankDetails = DEFAULT_ADMIN.bankDetails;
    if (!data.websiteSettings) {
        data.websiteSettings = Object.assign({}, DEFAULT_WEBSITE_SETTINGS);
    }
    if (!data.notificationLog) data.notificationLog = [];
    if (!data.userActivityLog) data.userActivityLog = [];
    if (!data.registeredUsers) data.registeredUsers = {};
    if (!data.internalTransfers) data.internalTransfers = [];
    if (!data.sendMoneyAuditLog) data.sendMoneyAuditLog = [];
    if (!data.processedSendMoneyKeys) data.processedSendMoneyKeys = {};
    return data;
}

function getAdminData() {
    try {
        const data = JSON.parse(localStorage.getItem(ADMIN_DATA_KEY));
        if (data && data.email) {
            ensureAdminDataShape(data);
            return syncAdminRegisteredUsers(migrateAdminBranding(data));
        }
    } catch (e) { /* ignore */ }
    const fresh = ensureAdminDataShape(Object.assign({}, DEFAULT_ADMIN, {
        payments: [], pendingTransfers: [], pendingDeposits: [],
        userActivityLog: [], registeredUsers: {}
    }));
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(fresh));
    return syncAdminRegisteredUsers(migrateAdminBranding(fresh));
}

function isAdminPanelPage() {
    if (typeof window === "undefined") return false;
    const page = window.location.pathname.split("/").pop() || "";
    return page === "admin-dashboard.html" || page === "admin.html";
}

function saveAdminData(data, options) {
    options = options || {};
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(data));
    if (options.skipServerSync !== true && isAdminPanelPage()) {
        syncAdminToServer(data);
    }
}

function appendPendingDepositOnServer(deposit) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, offline: true });
    }

    return registryFetch("/api/admin-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "append-deposit",
            deposit: deposit
        })
    })
        .then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok || !data.ok) {
                    return {
                        ok: false,
                        error: (data && data.error) || "Could not submit deposit to admin."
                    };
                }
                return data;
            });
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function approveDepositOnServer(depositId) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, offline: true });
    }

    return registryFetch("/api/admin-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "approve-deposit",
            depositId: depositId
        })
    })
        .then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok || !data.ok) {
                    return {
                        ok: false,
                        error: (data && data.error) || "Could not approve deposit on server."
                    };
                }
                return data;
            });
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function rejectDepositOnServer(depositId, reason) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve({ ok: false, offline: true });
    }

    return registryFetch("/api/admin-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "reject-deposit",
            depositId: depositId,
            reason: reason || ""
        })
    })
        .then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok || !data.ok) {
                    return {
                        ok: false,
                        error: (data && data.error) || "Could not reject deposit on server."
                    };
                }
                return data;
            });
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function mergeServerDepositResolutionLocally(serverResult) {
    if (!serverResult || !serverResult.email) return;

    const key = normalizeEmail(serverResult.email);
    if (serverResult.account) {
        applyServerAccountLocally(key, serverResult.account);
    }

    if (serverResult.depositId) {
        const admin = getAdminData();
        if (Array.isArray(admin.pendingDeposits)) {
            admin.pendingDeposits = admin.pendingDeposits.map(function(entry) {
                if (String(entry.id) !== String(serverResult.depositId)) return entry;
                return Object.assign({}, entry, {
                    status: serverResult.reason ? "rejected" : "approved",
                    resolvedAt: new Date().toLocaleString(),
                    rejectReason: serverResult.reason || entry.rejectReason
                });
            });
            saveAdminData(admin, { skipServerSync: true });
        }
        resolveDepositOnAccount(
            key,
            serverResult.depositId,
            serverResult.reason
                ? "Your deposit of $" + Number(serverResult.amount || 0).toFixed(2) + " was rejected" +
                    (serverResult.reason ? ": " + serverResult.reason : "")
                : "Your deposit of $" + Number(serverResult.amount || 0).toFixed(2) +
                    " was approved and credited — check your email for confirmation",
            {
                account: serverResult.account || getRegistryAccount(key),
                skipServerSync: true
            }
        );
    }
}

function mergeServerAdminLocally(serverAdmin) {
    if (!serverAdmin || !serverAdmin.email) return getAdminData();
    const admin = ensureAdminDataShape(migrateAdminBranding(serverAdmin));
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
    return admin;
}

function authenticateAdmin(email, password) {
    const admin = getAdminData();
    const key = normalizeEmail(email);
    const validEmail = key === normalizeEmail(admin.email) || isLegacyAdminEmail(key);
    if (!validEmail || admin.password !== password) return null;
    return admin;
}

function getAdminSession() {
    try {
        return JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));
    } catch (e) {
        return null;
    }
}

function setAdminSession() {
    const admin = getAdminData();
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
        email: normalizeEmail(admin.email)
    }));
}

function clearAdminSession() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
}

function requireAdminAuth() {
    const session = getAdminSession();
    const admin = getAdminData();
    if (!isAdminSessionValid(session, admin)) {
        window.location.href = "admin.html";
        return null;
    }
    if (session && normalizeEmail(session.email) !== normalizeEmail(admin.email)) {
        setAdminSession();
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

function syncAdminRegisteredUsers(admin) {
    if (!admin.registeredUsers) admin.registeredUsers = {};

    const accounts = getMergedAccountsRegistry();
    ensureAdminUserActivityLog(admin);

    let changed = false;
    const now = new Date().toISOString();

    Object.keys(accounts).forEach(function(email) {
        const key = normalizeEmail(email);
        const acct = accounts[email];
        const profile = acct.profile || {};
        const userName = profile.fullName || key;
        const existing = admin.registeredUsers[key];

        const entry = {
            email: key,
            name: userName,
            phone: profile.phone || "",
            memberSince: profile.memberSince || null,
            lastLoginAt: profile.lastLoginAt || null,
            lastLoginDevice: profile.lastLoginDevice || null,
            emailVerified: !!acct.emailVerified,
            verificationStatus: profile.verificationStatus || "Pending",
            withdrawalsFrozen: !!acct.withdrawalsFrozen,
            linkedAt: existing && existing.linkedAt ? existing.linkedAt : now,
            updatedAt: now
        };

        if (!existing) {
            admin.registeredUsers[key] = entry;
            changed = true;

            const hasSignup = admin.userActivityLog.some(function(e) {
                return e.type === "signup" && normalizeEmail(e.userEmail) === key;
            });

            if (!hasSignup) {
                admin.userActivityLog.unshift({
                    id: Date.now() + Math.random(),
                    date: entry.memberSince
                        ? new Date(entry.memberSince).toLocaleString()
                        : new Date().toLocaleString(),
                    userEmail: key,
                    userName: userName,
                    type: "signup",
                    description: "Account automatically linked to admin dashboard",
                    amount: 0
                });
            }
        } else if (
            existing.name !== entry.name ||
            existing.lastLoginAt !== entry.lastLoginAt ||
            existing.emailVerified !== entry.emailVerified ||
            existing.verificationStatus !== entry.verificationStatus ||
            existing.withdrawalsFrozen !== entry.withdrawalsFrozen
        ) {
            admin.registeredUsers[key] = Object.assign({}, existing, entry);
            changed = true;
        }
    });

    Object.keys(admin.registeredUsers).forEach(function(email) {
        const key = normalizeEmail(email);
        if (!accounts[key]) {
            delete admin.registeredUsers[email];
            changed = true;
        }
    });

    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
        changed = true;
    }

    if (changed) saveAdminData(admin, { skipServerSync: true });
    return admin;
}

function ensureAdminUserActivityLog(admin) {
    if (!admin.userActivityLog) admin.userActivityLog = [];
    return admin.userActivityLog;
}

function recordAdminUserEvent(userEmail, type, description, amount) {
    const admin = getAdminData();
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    const userName = account && account.profile ? account.profile.fullName : key;

    ensureAdminUserActivityLog(admin);
    admin.userActivityLog.unshift({
        id: Date.now() + Math.random(),
        date: new Date().toLocaleString(),
        userEmail: key,
        userName: userName,
        type: type,
        description: description,
        amount: amount != null ? amount : 0
    });

    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
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
    repairAccountsStorage();
    getAdminData();
    const accounts = getMergedAccountsRegistry();
    const pendingDeposits = getPendingDeposits();
    const pendingTransfers = getPendingTransfers();

    return Object.keys(accounts).map(function(email) {
        try {
            const acct = accounts[email];
            if (!acct || typeof acct !== "object") return null;
            const profile = acct.profile || {};
            const lastTx = acct.transactions && acct.transactions[0];
            const emailKey = normalizeEmail(email);
            const depositCount = pendingDeposits.filter(function(d) {
                return normalizeEmail(d.userEmail) === emailKey;
            }).length;
            const transferCount = pendingTransfers.filter(function(t) {
                return normalizeEmail(t.userEmail) === emailKey;
            }).length;

            return {
                email: emailKey,
                name: profile.fullName || emailKey,
                phone: profile.phone || "—",
                cash: acct.cash || 0,
                holdingsSummary: getHoldingsSummary(acct.holdings),
                lastActivity: lastTx ? lastTx.description : "Account registered",
                lastActivityDate: lastTx ? lastTx.date : (profile.memberSince
                    ? new Date(profile.memberSince).toLocaleString() : "—"),
                transactionCount: (acct.transactions || []).length,
                memberSince: profile.memberSince || null,
                lastLoginAt: profile.lastLoginAt || null,
                lastLoginDevice: profile.lastLoginDevice || null,
                verificationStatus: profile.verificationStatus || "Pending",
                emailVerified: !!acct.emailVerified,
                withdrawalsFrozen: !!acct.withdrawalsFrozen,
                withdrawalsFrozenReason: acct.withdrawalsFrozenReason || "",
                pendingDeposits: depositCount,
                pendingTransfers: transferCount,
                accountComplete: isCompleteAccount(acct)
            };
        } catch (e) {
            return null;
        }
    }).filter(function(u) { return !!u; }).sort(function(a, b) {
        const aTime = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        const bTime = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
        return a.email.localeCompare(b.email);
    });
}

function getUserDetailForAdmin(email) {
    const account = getRegistryAccount(email);
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
        transactionCount: (account.transactions || []).length,
        emailVerified: !!account.emailVerified,
        withdrawalsFrozen: !!account.withdrawalsFrozen,
        withdrawalsFrozenReason: account.withdrawalsFrozenReason || "",
        withdrawalsFrozenAt: account.withdrawalsFrozenAt || null,
        pendingDeposits: getUserPendingDeposits(email),
        pendingTransfers: getUserPendingTransfers(email),
        supportItems: getAllSupportItems("all").filter(function(item) {
            return normalizeEmail(item.userEmail) === normalizeEmail(email);
        })
    };
}

function getAllUserActivity(filterEmail, limit) {
    limit = limit || 100;
    const accounts = getMergedAccountsRegistry();
    const admin = getAdminData();
    let activities = [];

    (admin.userActivityLog || []).forEach(function(entry) {
        if (filterEmail && normalizeEmail(entry.userEmail) !== normalizeEmail(filterEmail)) return;
        activities.push({
            userEmail: entry.userEmail,
            userName: entry.userName,
            date: entry.date,
            description: entry.description,
            amount: entry.amount || 0
        });
    });

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
    const account = getRegistryAccount(key);
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

    applyAdminBalanceAdjustment(key, account, action, amount, note);
    return { ok: true, email: key, newBalance: account.cash };
}

function applyAdminBalanceAdjustment(key, account, action, amount, note) {
    const admin = getAdminData();
    const userName = account.profile ? account.profile.fullName : key;
    const noteText = note ? String(note).trim() : "";
    const label = action === "credit" ? "Admin Credit" : "Admin Debit";
    const description = noteText ? label + " — " + noteText : label;

    if (action === "credit") {
        account.cash = (account.cash || 0) + amount;
        admin.balance = (admin.balance || 0) - amount;
    } else {
        account.cash = (account.cash || 0) - amount;
        admin.balance = (admin.balance || 0) + amount;
    }

    if (!Array.isArray(account.transactions)) account.transactions = [];
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: description,
        amount: action === "credit" ? amount : -amount
    });

    ensureNotifications(account);
    pushAccountNotification(account, action === "credit"
        ? "Your account was credited $" + amount.toFixed(2)
        : "Your account was debited $" + amount.toFixed(2),
        { type: "admin" }
    );

    account.serverSyncedAt = new Date().toISOString();

    if (!Array.isArray(admin.payments)) admin.payments = [];
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

    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
    saveAccount(key, account, { skipServerSync: true });
}

function adminAdjustUserBalanceAsync(userEmail, action, amount, note) {
    const key = normalizeEmail(userEmail);
    const account = getRegistryAccount(key);
    if (!account) {
        return Promise.resolve({ ok: false, error: "User not found." });
    }
    amount = parseFloat(amount);
    if (!amount || amount <= 0) {
        return Promise.resolve({ ok: false, error: "Enter a valid amount." });
    }
    if (action === "debit" && (account.cash || 0) < amount) {
        return Promise.resolve({ ok: false, error: "User has insufficient cash for this debit." });
    }

    const userName = account.profile ? account.profile.fullName : key;
    applyAdminBalanceAdjustment(key, account, action, amount, note);

    const admin = getAdminData();
    return syncAccountToServer(key, account, "admin-adjust")
        .then(function(accountResult) {
            if (!accountResult || (!accountResult.ok && !accountResult.offline)) {
                throw new Error((accountResult && accountResult.error) || "Failed to save balance on server.");
            }
            return syncAdminToServer(admin);
        })
        .then(function(adminResult) {
            if (adminResult && adminResult.ok === false && !adminResult.offline) {
                throw new Error((adminResult && adminResult.error) || "Failed to save admin registry.");
            }

            const cache = Object.assign({}, getServerAccountsCache());
            cache[key] = account;
            setServerAccountsCache(cache);

            const accounts = getAllAccounts();
            accounts[key] = account;
            localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
            notifyAccountsChanged();
            syncAdminRegisteredUsers(getAdminData());

            return {
                ok: true,
                email: key,
                userName: userName,
                action: action,
                amount: amount,
                newBalance: account.cash
            };
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function adminSetWithdrawalsFrozen(userEmail, frozen, reason) {
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "User not found." };
    }

    const admin = getAdminData();
    const userName = account.profile ? account.profile.fullName : key;
    const now = new Date().toISOString();
    const note = String(reason || "").trim();

    account.withdrawalsFrozen = !!frozen;
    account.withdrawalsFrozenReason = frozen ? note : "";
    account.withdrawalsFrozenAt = frozen ? now : null;

    account.notifications.unshift({
        id: Date.now() + Math.random(),
        message: frozen
            ? "Withdrawals have been frozen on your account" + (note ? ": " + note : ".")
            : "Withdrawal restrictions have been lifted on your account.",
        time: now,
        read: false
    });
    if (account.notifications.length > 30) {
        account.notifications = account.notifications.slice(0, 30);
    }

    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: frozen
            ? "Withdrawals frozen by admin" + (note ? " — " + note : "")
            : "Withdrawals unfrozen by admin",
        amount: 0
    });

    saveAccount(key, account);

    recordAdminUserEvent(
        key,
        frozen ? "admin-freeze" : "admin-unfreeze",
        (frozen ? "Withdrawals frozen" : "Withdrawals unfrozen") + (note ? " — " + note : ""),
        0
    );

    if (admin.registeredUsers && admin.registeredUsers[key]) {
        admin.registeredUsers[key].withdrawalsFrozen = !!frozen;
        saveAdminData(admin);
    }

    return { ok: true, email: key, userName: userName, frozen: !!frozen };
}

function adminRejectPendingForUser(userEmail, reason) {
    const key = normalizeEmail(userEmail);
    const rejectNote = reason || "Account removed by admin";

    (getAdminData().pendingTransfers || []).filter(function(t) {
        return normalizeEmail(t.userEmail) === key && t.status === "pending";
    }).forEach(function(t) {
        rejectTransfer(t.id, rejectNote);
    });

    (getAdminData().pendingDeposits || []).filter(function(d) {
        return normalizeEmail(d.userEmail) === key && d.status === "pending";
    }).forEach(function(d) {
        rejectDeposit(d.id, rejectNote);
    });
}

function adminDeleteUser(userEmail) {
    const key = normalizeEmail(userEmail);
    if (!key || key.indexOf("@") === -1) {
        return { ok: false, error: "Invalid email." };
    }
    if (isProtectedAdminAccount(key)) {
        return { ok: false, error: "The admin account cannot be deleted." };
    }

    const account = getRegistryAccount(key);
    if (!account) {
        return { ok: false, error: "User not found." };
    }

    const userName = account.profile ? account.profile.fullName : key;
    adminRejectPendingForUser(key, "Account deleted by admin");
    markAccountDeleted(key);
    removeAccountEverywhere(key);

    const admin = getAdminData();
    if (admin.registeredUsers && admin.registeredUsers[key]) {
        delete admin.registeredUsers[key];
    }

    ensureAdminUserActivityLog(admin);
    admin.userActivityLog.unshift({
        id: Date.now() + Math.random(),
        date: new Date().toLocaleString(),
        userEmail: key,
        userName: userName,
        type: "admin-delete",
        description: "Account deleted by admin — " + userName,
        amount: 0
    });
    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
    deleteAccountFromServer(key);

    return { ok: true, email: key, userName: userName };
}

function adminDeleteUserAsync(userEmail, options) {
    options = options || {};
    const key = normalizeEmail(userEmail);
    if (!key || key.indexOf("@") === -1) {
        return Promise.resolve({ ok: false, error: "Invalid email." });
    }
    if (isProtectedAdminAccount(key)) {
        return Promise.resolve({ ok: false, error: "The admin account cannot be deleted." });
    }

    const account = getRegistryAccount(key);
    if (!account) {
        return Promise.resolve({ ok: false, error: "User not found." });
    }

    const userName = account.profile ? account.profile.fullName : key;
    adminRejectPendingForUser(key, "Account deleted by admin");
    markAccountDeleted(key);
    removeAccountEverywhere(key);

    const admin = getAdminData();
    if (admin.registeredUsers && admin.registeredUsers[key]) {
        delete admin.registeredUsers[key];
    }

    ensureAdminUserActivityLog(admin);
    admin.userActivityLog.unshift({
        id: Date.now() + Math.random(),
        date: new Date().toLocaleString(),
        userEmail: key,
        userName: userName,
        type: "admin-delete",
        description: "Account deleted by admin — " + userName,
        amount: 0
    });
    if (admin.userActivityLog.length > 500) {
        admin.userActivityLog = admin.userActivityLog.slice(0, 500);
    }
    localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));

    const serverStep = isServerSyncAvailable()
        ? deleteAccountFromServer(key).then(function(result) {
            if (!result || !result.ok) {
                throw new Error((result && result.error) || "Could not delete account on server.");
            }
            return result;
        })
        : Promise.resolve({ ok: true, offline: true });

    return serverStep
        .then(function() { return syncAdminToServer(admin); })
        .then(function() {
            if (isServerSyncAvailable() && !options.skipRegistryPull) {
                return pullAccountsFromServer();
            }
            return null;
        })
        .then(function(pullResult) {
            if (pullResult && pullResult.accounts && pullResult.accounts[key]) {
                throw new Error("Account still exists on server after delete.");
            }
            clearAccountDeletedMark(key);
            if (!options.skipRegistrySync) {
                syncAdminRegisteredUsers(getAdminData());
            }
            return { ok: true, email: key, userName: userName };
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err), email: key };
        });
}

function adminDeleteAllUsersAsync() {
    const users = getManageableUsersSummary().slice();
    if (!users.length) {
        return Promise.resolve({ ok: true, deleted: 0, failed: [], total: 0 });
    }

    let deleted = 0;
    const failed = [];

    return users.reduce(function(chain, user) {
        return chain.then(function() {
            return adminDeleteUserAsync(user.email, {
                skipRegistryPull: true,
                skipRegistrySync: true
            }).then(function(result) {
                if (result.ok) {
                    deleted += 1;
                } else {
                    failed.push({
                        email: user.email,
                        name: user.name,
                        error: result.error || "Delete failed."
                    });
                }
            });
        });
    }, Promise.resolve()).then(function() {
        const admin = getAdminData();
        ensureAdminUserActivityLog(admin);
        admin.userActivityLog.unshift({
            id: Date.now() + Math.random(),
            date: new Date().toLocaleString(),
            userEmail: "bulk",
            userName: "Admin bulk action",
            type: "admin-delete",
            description: "Bulk deleted " + deleted + " customer account(s)",
            amount: 0
        });
        if (admin.userActivityLog.length > 500) {
            admin.userActivityLog = admin.userActivityLog.slice(0, 500);
        }
        localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));

        const finalize = isServerSyncAvailable()
            ? syncAdminToServer(admin).then(function() {
                return pullAccountsFromServer();
            })
            : Promise.resolve(null);

        return finalize.then(function() {
            syncAdminRegisteredUsers(getAdminData());
            return {
                ok: failed.length === 0,
                deleted: deleted,
                failed: failed,
                total: users.length
            };
        });
    });
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

function isWithdrawalsFrozen(userEmail) {
    const account = getAccount(userEmail);
    return !!(account && account.withdrawalsFrozen);
}

function getWithdrawalsFrozenMessage(userEmail) {
    const account = getAccount(userEmail);
    if (!account || !account.withdrawalsFrozen) return "";
    return account.withdrawalsFrozenReason
        ? "Withdrawals are frozen: " + account.withdrawalsFrozenReason
        : "Withdrawals are temporarily frozen on this account. Contact support for assistance.";
}

function submitTransferRequest(userEmail, amount, destination, method) {
    const key = normalizeEmail(userEmail);
    const account = getAccount(key);
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    if (account.withdrawalsFrozen) {
        return { ok: false, error: getWithdrawalsFrozenMessage(key) };
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
    pushAccountNotification(account,
        "Withdrawal request of $" + amount.toFixed(2) + " to " + dest + " submitted — awaiting admin approval",
        { type: "withdrawal" }
    );

    sendWithdrawalSubmittedEmail(account, key, amount, dest, transfer.method);
    saveAccount(key, account);
    recordAdminUserEvent(key, "withdrawal", "Withdrawal request submitted — " + dest, -amount);
    return { ok: true, transfer: transfer };
}

function resolveTransferOnAccount(userEmail, transferId, message, options) {
    options = options || {};
    const account = getAccount(userEmail);
    if (!account) return;

    if (account.pendingTransfers) {
        account.pendingTransfers = account.pendingTransfers.filter(function(t) {
            return t.id !== transferId;
        });
    }

    pushAccountNotification(account, message, { type: options.type || "transfer" });

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

    sendWithdrawalApprovedEmail(account, transfer.userEmail, transfer.amount, transfer.destination, transfer.method);
    saveAccount(transfer.userEmail, account);
    recordUserPayment(transfer.userEmail, "withdraw", transfer.amount, transfer.method);
    saveAdminData(admin);

    resolveTransferOnAccount(
        transfer.userEmail,
        transferId,
        "Withdrawal of $" + transfer.amount.toFixed(2) + " to " + transfer.destination + " was approved",
        { type: "withdrawal" }
    );

    return { ok: true, emailQueued: true };
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
        sendWithdrawalRejectedEmail(accountTx, transfer.userEmail, transfer.amount, transfer.destination, transfer.rejectReason);
        saveAccount(transfer.userEmail, accountTx);
    }

    saveAdminData(admin);

    resolveTransferOnAccount(
        transfer.userEmail,
        transferId,
        "Withdrawal of $" + transfer.amount.toFixed(2) + " was rejected" +
            (reason ? ": " + reason : ""),
        { type: "withdrawal" }
    );

    return { ok: true, emailQueued: true };
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
            "Log in to GlobalVest → Support to view the full conversation.\n\n" +
            "GlobalVest Support",
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

function getPendingDepositsFromAccounts() {
    const accounts = getMergedAccountsRegistry();
    const deposits = [];

    Object.keys(accounts).forEach(function(email) {
        const key = normalizeEmail(email);
        if (!key || isProtectedAdminAccount(key)) return;

        const acct = accounts[key] || accounts[email];
        if (!acct || !Array.isArray(acct.pendingDeposits)) return;

        const userName = acct.profile ? acct.profile.fullName : key;
        acct.pendingDeposits.forEach(function(d) {
            if (!d) return;
            if (d.status && d.status !== "pending") return;

            deposits.push({
                id: d.id,
                userEmail: key,
                userName: userName,
                amount: d.amount,
                btcAmount: d.btcAmount,
                method: d.method || "crypto",
                payTo: d.payTo || getAdminWalletAddress(),
                status: "pending",
                requestedAt: d.requestedAt || null,
                date: d.date || new Date().toLocaleString(),
                source: "account"
            });
        });
    });

    return deposits;
}

function linkAccountPendingDepositsToAdmin() {
    const admin = getAdminData();
    if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];

    const accountDeposits = getPendingDepositsFromAccounts();
    let changed = false;

    accountDeposits.forEach(function(dep) {
        const exists = admin.pendingDeposits.some(function(entry) {
            return String(entry.id) === String(dep.id) ||
                (normalizeEmail(entry.userEmail) === dep.userEmail &&
                    Number(entry.amount) === Number(dep.amount) &&
                    (!entry.status || entry.status === "pending"));
        });
        if (!exists) {
            admin.pendingDeposits.unshift(Object.assign({}, dep));
            changed = true;
        }
    });

    if (changed) {
        localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
        if (isAdminPanelPage()) {
            saveAdminData(admin);
        }
    }

    return admin;
}

function findPendingDepositById(depositId) {
    return getPendingDeposits().find(function(d) {
        return String(d.id) === String(depositId);
    }) || null;
}

function ensurePendingDepositInAdminRegistry(deposit) {
    const admin = getAdminData();
    if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];

    let entry = admin.pendingDeposits.find(function(d) {
        return String(d.id) === String(deposit.id);
    });

    if (!entry) {
        entry = Object.assign({}, deposit);
        admin.pendingDeposits.unshift(entry);
        localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
    }

    return { admin: admin, deposit: entry };
}

function getPendingDeposits() {
    const seen = {};
    const merged = [];

    function addDeposit(dep) {
        if (!dep) return;
        if (dep.status && dep.status !== "pending") return;

        const idKey = dep.id != null ? String(dep.id) : "";
        const fallbackKey = normalizeEmail(dep.userEmail) + ":" + String(dep.amount) + ":" + String(dep.date || "");
        const key = idKey || fallbackKey;
        if (seen[key]) return;
        seen[key] = true;
        merged.push(dep);
    }

    (getAdminData().pendingDeposits || []).forEach(addDeposit);
    getPendingDepositsFromAccounts().forEach(addDeposit);
    return merged;
}

function getUserPendingDeposits(userEmail) {
    return getPendingDeposits().filter(function(d) {
        return d.userEmail === normalizeEmail(userEmail);
    });
}

function submitDepositRequest(userEmail, amount, method, btcAmount) {
    const key = normalizeEmail(userEmail);
    const account = getRegistryAccount(key) || getAccount(key);
    if (!account) {
        return { ok: false, error: "Account not found." };
    }

    amount = parseFloat(amount);
    if (!amount || amount <= 0) {
        return { ok: false, error: "Enter a valid amount." };
    }

    method = "crypto";
    if (!isDepositMethodEnabled(method)) {
        const info = DEPOSIT_METHODS[method];
        return { ok: false, error: info ? info.unavailable : "Bitcoin deposits are unavailable." };
    }

    const payTo = getAdminWalletAddress();
    if (!payTo) {
        return { ok: false, error: "Deposit address is not configured. Please contact support." };
    }

    if (btcAmount != null && btcAmount !== "") {
        btcAmount = parseFloat(btcAmount);
        if (!btcAmount || btcAmount <= 0) btcAmount = null;
    } else {
        btcAmount = null;
    }

    const userName = account.profile ? account.profile.fullName : key;

    const deposit = {
        id: "dep-" + Date.now() + Math.random().toString(36).slice(2, 7),
        userEmail: key,
        userName: userName,
        amount: amount,
        btcAmount: btcAmount,
        method: method,
        payTo: payTo,
        status: "pending",
        requestedAt: new Date().toISOString(),
        date: new Date().toLocaleString()
    };

    if (!account.pendingDeposits) account.pendingDeposits = [];
    account.pendingDeposits.push({
        id: deposit.id, amount: amount, btcAmount: btcAmount, method: method, payTo: payTo, status: "pending", date: deposit.date
    });

    account.transactions.unshift({
        date: deposit.date,
        description: method === "crypto"
            ? "Deposit Request (Pending) — crypto → " + payTo
            : "Deposit Request (Pending) — " + method + " → Admin",
        amount: 0
    });
    pushAccountNotification(account, method === "crypto"
        ? "Deposit of $" + amount.toFixed(2) + " submitted — send BTC to " + payTo + ". Awaiting admin approval."
        : "Deposit of $" + amount.toFixed(2) + " submitted — awaiting admin approval before funds are credited.",
        { type: "deposit" }
    );

    saveAccount(key, account, { skipServerSync: true });

    return { ok: true, deposit: deposit, payTo: payTo, account: account };
}

function submitDepositRequestAsync(userEmail, amount, method, btcAmount) {
    const result = submitDepositRequest(userEmail, amount, method, btcAmount);
    if (!result.ok) {
        return Promise.resolve(result);
    }

    const key = normalizeEmail(userEmail);

    return syncAccountToServer(key, result.account, "deposit-submit")
        .then(function(syncResult) {
            if (!syncResult || (!syncResult.ok && !syncResult.offline)) {
                throw new Error((syncResult && syncResult.error) || "Could not save deposit to your account.");
            }
            if (syncResult.account) {
                applyServerAccountLocally(key, syncResult.account);
            }
            return appendPendingDepositOnServer(result.deposit);
        })
        .then(function(serverResult) {
            if (!serverResult || (!serverResult.ok && !serverResult.offline)) {
                throw new Error((serverResult && serverResult.error) || "Could not send deposit to admin.");
            }

            if (serverResult.offline) {
                const admin = getAdminData();
                if (!Array.isArray(admin.pendingDeposits)) admin.pendingDeposits = [];
                admin.pendingDeposits.unshift(result.deposit);
                saveAdminData(admin, { skipServerSync: true });
                return sendDepositSubmittedEmail(
                    result.account,
                    key,
                    amount,
                    method,
                    result.payTo
                ).then(function(emailResult) {
                    return {
                        ok: true,
                        deposit: result.deposit,
                        payTo: result.payTo,
                        emailSent: !!(emailResult && emailResult.ok)
                    };
                });
            }

            applyPendingDepositToLocalRegistry(serverResult.deposit, serverResult.pendingDeposits);
            if (serverResult.account) {
                applyServerAccountLocally(key, serverResult.account);
            }

            return {
                ok: true,
                deposit: result.deposit,
                payTo: result.payTo,
                emailSent: serverResult.emailSent !== false
            };
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function resolveDepositOnAccount(userEmail, depositId, message, options) {
    options = options || {};
    const account = options.account || getRegistryAccount(userEmail) || getAccount(userEmail);
    if (!account) return null;

    if (account.pendingDeposits) {
        account.pendingDeposits = account.pendingDeposits.filter(function(d) {
            return d.id !== depositId;
        });
    }

    pushAccountNotification(account, message, { type: "deposit" });

    saveAccount(userEmail, account, { skipServerSync: options.skipServerSync === true });
    return account;
}

function approveDeposit(depositId) {
    const pending = findPendingDepositById(depositId);
    if (!pending) {
        return { ok: false, error: "Deposit request not found." };
    }

    const ensured = ensurePendingDepositInAdminRegistry(pending);
    const admin = ensured.admin;
    const deposit = ensured.deposit;

    const key = normalizeEmail(deposit.userEmail);
    const account = getRegistryAccount(key);
    if (!account) {
        return { ok: false, error: "User account not found." };
    }

    account.cash = (account.cash || 0) + deposit.amount;
    account.transactions.unshift({
        date: new Date().toLocaleString(),
        description: "Deposit Approved (" + deposit.method + ") — paid to admin",
        amount: deposit.amount
    });
    account.serverSyncedAt = new Date().toISOString();

    deposit.status = "approved";
    deposit.resolvedAt = new Date().toLocaleString();

    recordUserPayment(key, "deposit", deposit.amount, deposit.method);

    resolveDepositOnAccount(
        key,
        depositId,
        "Deposit of $" + deposit.amount.toFixed(2) + " was approved and credited to your balance",
        { account: account, skipServerSync: true }
    );

    saveAdminData(admin);

    return {
        ok: true,
        email: key,
        account: account,
        amount: deposit.amount,
        method: deposit.method
    };
}

function rejectDepositAsync(depositId, reason) {
    return rejectDepositOnServer(depositId, reason)
        .then(function(serverResult) {
            if (serverResult && serverResult.offline) {
                return rejectDepositOfflineAsync(depositId, reason);
            }
            if (!serverResult || !serverResult.ok) {
                return {
                    ok: false,
                    error: (serverResult && serverResult.error) || "Could not reject deposit."
                };
            }
            mergeServerDepositResolutionLocally(serverResult);
            return pullAdminFromServer().then(function() {
                return {
                    ok: true,
                    emailSent: serverResult.emailSent !== false
                };
            });
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function rejectDepositOfflineAsync(depositId, reason) {
    const result = rejectDeposit(depositId, reason);
    if (!result.ok) {
        return Promise.resolve(result);
    }

    const admin = getAdminData();
    return syncAdminToServer(admin)
        .then(function(syncResult) {
            if (syncResult && syncResult.ok === false && !syncResult.offline) {
                throw new Error((syncResult && syncResult.error) || "Failed to save rejection on server.");
            }
            if (!result.account) {
                return { ok: true, emailSent: false };
            }
            return sendDepositRejectedEmail(
                result.account,
                result.email,
                result.amount,
                result.method,
                result.reason
            );
        })
        .then(function(emailResult) {
            if (emailResult && emailResult.ok !== undefined) {
                return { ok: true, emailSent: !!emailResult.ok };
            }
            return emailResult;
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function approveDepositAsync(depositId) {
    return approveDepositOnServer(depositId)
        .then(function(serverResult) {
            if (serverResult && serverResult.offline) {
                return approveDepositOfflineAsync(depositId);
            }
            if (!serverResult || !serverResult.ok) {
                return {
                    ok: false,
                    error: (serverResult && serverResult.error) || "Could not approve deposit."
                };
            }
            mergeServerDepositResolutionLocally(serverResult);
            return pullAdminFromServer().then(function() {
                return {
                    ok: true,
                    emailSent: serverResult.emailSent !== false
                };
            });
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function approveDepositOfflineAsync(depositId) {
    const result = approveDeposit(depositId);
    if (!result.ok) {
        return Promise.resolve(result);
    }

    return syncAccountToServer(result.email, result.account, "deposit-approve")
        .then(function(syncResult) {
            if (!syncResult || (!syncResult.ok && !syncResult.offline)) {
                throw new Error((syncResult && syncResult.error) || "Failed to credit deposit on server.");
            }

            const admin = getAdminData();
            return syncAdminToServer(admin).then(function() {
                const cache = Object.assign({}, getServerAccountsCache());
                cache[result.email] = result.account;
                setServerAccountsCache(cache);
                return sendDepositApprovedEmail(
                    result.account,
                    result.email,
                    result.amount,
                    result.method
                );
            });
        })
        .then(function(emailResult) {
            return { ok: true, emailSent: !!(emailResult && emailResult.ok) };
        })
        .catch(function(err) {
            return { ok: false, error: err.message || String(err) };
        });
}

function rejectDeposit(depositId, reason) {
    const pending = findPendingDepositById(depositId);
    if (!pending) {
        return { ok: false, error: "Deposit request not found." };
    }

    const ensured = ensurePendingDepositInAdminRegistry(pending);
    const admin = ensured.admin;
    const deposit = ensured.deposit;

    deposit.status = "rejected";
    deposit.resolvedAt = new Date().toLocaleString();
    deposit.rejectReason = reason || "Rejected by admin";

    const key = normalizeEmail(deposit.userEmail);
    const accountTx = getRegistryAccount(key) || getAccount(key);
    if (accountTx) {
        accountTx.transactions.unshift({
            date: new Date().toLocaleString(),
            description: "Deposit Rejected (" + deposit.method + ")",
            amount: 0
        });
        saveAccount(key, accountTx, { eventType: "login" });
    }

    saveAdminData(admin);

    resolveDepositOnAccount(
        key,
        depositId,
        "Deposit of $" + deposit.amount.toFixed(2) + " was rejected" +
            (reason ? ": " + reason : "")
    );

    return {
        ok: true,
        email: key,
        account: accountTx,
        amount: deposit.amount,
        method: deposit.method,
        reason: deposit.rejectReason
    };
}

function isValidGvWalletAddress(address) {
    return /^GV[A-Z0-9]{12,28}$/i.test(String(address || "").trim());
}

function generateGvWalletAddress(email) {
    const normalized = normalizeEmail(email);
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
        hash |= 0;
    }
    const partA = Math.abs(hash).toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(8, "0").slice(0, 8);
    let sum = 0;
    for (let j = 0; j < normalized.length; j++) {
        sum += normalized.charCodeAt(j);
    }
    const partB = sum.toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "Y").padEnd(6, "0").slice(0, 6);
    return "GV" + partA + partB;
}

function ensureGvWallet(account, email) {
    if (!account) return "";
    if (!account.gvWalletAddress) {
        account.gvWalletAddress = generateGvWalletAddress(email);
    }
    return account.gvWalletAddress;
}

function maskSendMoneyEmail(email) {
    const parts = String(email || "").split("@");
    if (parts.length !== 2) return "—";
    const local = parts[0];
    const masked = local.length <= 2
        ? local.charAt(0) + "***"
        : local.charAt(0) + "***" + local.charAt(local.length - 1);
    return masked + "@" + parts[1];
}

function maskSendMoneyWallet(address) {
    const value = String(address || "");
    if (value.length <= 10) return value;
    return value.slice(0, 6) + "••••" + value.slice(-4);
}

function getSendMoneyBalance(account, currency) {
    currency = String(currency || "USD").toUpperCase();
    if (!account) return 0;
    if (currency === "USD") {
        return Number(account.cash || 0);
    }
    const key = SEND_MONEY_HOLDING_KEYS[currency];
    if (!key) return 0;
    ensureHoldings(account);
    return Number(account.holdings[key] || 0);
}

function calculateSendMoneyFee(amount, currency) {
    currency = String(currency || "USD").toUpperCase();
    amount = Number(amount);
    if (!amount || amount <= 0) return 0;
    if (currency === "USD") return 0;
    return Math.max(amount * 0.001, 0.00000001);
}

function buildSendMoneyRecipientPreview(email, account) {
    const verified = account.profile &&
        account.profile.verificationStatus === "Verified" &&
        !!account.profile.ssnLast4;
    const fullName = account.profile && account.profile.fullName
        ? account.profile.fullName
        : email;
    const initials = fullName.split(" ").map(function(part) {
        return part.charAt(0);
    }).join("").slice(0, 2).toUpperCase();

    return {
        found: true,
        email: email,
        fullName: fullName,
        initials: initials || "GV",
        verified: verified,
        country: (account.profile && account.profile.country) || "—",
        maskedEmail: maskSendMoneyEmail(email),
        walletAddress: ensureGvWallet(account, email),
        maskedWallet: maskSendMoneyWallet(ensureGvWallet(account, email)),
        walletType: "GlobalVest Internal Wallet"
    };
}

function lookupSendMoneyRecipientLocal(query) {
    const value = String(query || "").trim();
    if (!value) {
        return { ok: false, error: "Enter a recipient email or wallet address." };
    }

    if (isValidEmail(value)) {
        const key = findAccountKey(value) || normalizeEmail(value);
        const account = getAccount(key);
        if (!account) {
            return { ok: false, found: false, error: "Recipient not found." };
        }
        return {
            ok: true,
            method: "email",
            recipient: buildSendMoneyRecipientPreview(key, account)
        };
    }

    if (!isValidGvWalletAddress(value)) {
        return { ok: false, error: "Enter a valid GlobalVest email or wallet address." };
    }

    const target = value.toUpperCase();
    const accounts = getAllAccounts();
    const keys = Object.keys(accounts);
    for (let i = 0; i < keys.length; i++) {
        const email = keys[i];
        const account = accounts[email];
        if (!account) continue;
        const wallet = ensureGvWallet(account, email);
        if (String(wallet).toUpperCase() === target) {
            return {
                ok: true,
                method: "wallet",
                recipient: buildSendMoneyRecipientPreview(email, account)
            };
        }
    }

    return { ok: false, found: false, error: "Recipient not found." };
}

function lookupSendMoneyRecipientAsync(query) {
    if (!isServerSyncAvailable()) {
        return Promise.resolve(lookupSendMoneyRecipientLocal(query));
    }

    return registryFetch("/api/send-money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup", recipient: query })
    })
        .then(function(response) { return response.json(); })
        .catch(function() {
            return lookupSendMoneyRecipientLocal(query);
        });
}

function applySendMoneyBalanceDelta(account, currency, delta) {
    currency = String(currency || "USD").toUpperCase();
    delta = Number(delta);
    if (currency === "USD") {
        account.cash = Number(account.cash || 0) + delta;
        return;
    }
    const key = SEND_MONEY_HOLDING_KEYS[currency];
    if (!key) throw new Error("Invalid currency.");
    ensureHoldings(account);
    account.holdings[key] = Number(account.holdings[key] || 0) + delta;
}

function executeSendMoneyOffline(payload) {
    const senderEmail = normalizeEmail(payload.senderEmail);
    const lookup = lookupSendMoneyRecipientLocal(payload.recipient);
    if (!lookup.ok || !lookup.recipient) {
        return { ok: false, error: lookup.error || "Recipient not found." };
    }

    const recipientEmail = normalizeEmail(lookup.recipient.email);
    if (recipientEmail === senderEmail) {
        return { ok: false, error: "You cannot send money to yourself." };
    }

    const sender = getAccount(senderEmail);
    const recipient = getAccount(recipientEmail);
    if (!sender || !recipient) {
        return { ok: false, error: "Sender or recipient account not found." };
    }
    if (isWithdrawalsFrozen(senderEmail)) {
        return { ok: false, error: getWithdrawalsFrozenMessage(senderEmail) };
    }
    if (isWithdrawalsFrozen(recipientEmail)) {
        return { ok: false, error: "Recipient account cannot receive transfers." };
    }

    const currency = String(payload.currency || "USD").toUpperCase();
    const amount = Number(payload.amount);
    if (!SEND_MONEY_CURRENCIES.includes(currency)) {
        return { ok: false, error: "Invalid currency." };
    }
    if (!amount || amount <= 0) {
        return { ok: false, error: "Enter a valid amount greater than zero." };
    }

    const fee = calculateSendMoneyFee(amount, currency);
    const totalDebit = amount + fee;
    const available = getSendMoneyBalance(sender, currency);
    if (available < totalDebit) {
        return { ok: false, error: "Insufficient balance." };
    }

    const reference = "GV-TXN-" + Date.now().toString(36).toUpperCase() + "-" +
        Math.random().toString(36).slice(2, 8).toUpperCase();
    const now = new Date().toISOString();
    const txDate = new Date().toLocaleString();

    applySendMoneyBalanceDelta(sender, currency, -totalDebit);
    applySendMoneyBalanceDelta(recipient, currency, amount);

    if (!Array.isArray(sender.sendMoneyHistory)) sender.sendMoneyHistory = [];
    if (!Array.isArray(recipient.sendMoneyHistory)) recipient.sendMoneyHistory = [];

    const transfer = {
        id: "smt-" + Date.now(),
        reference: reference,
        senderEmail: senderEmail,
        recipientEmail: recipientEmail,
        senderWallet: ensureGvWallet(sender, senderEmail),
        recipientWallet: ensureGvWallet(recipient, recipientEmail),
        method: lookup.method,
        currency: currency,
        amount: amount,
        fee: fee,
        totalDebit: totalDebit,
        status: "completed",
        note: String(payload.note || "").trim().slice(0, 280),
        ipAddress: payload.ipAddress || "",
        deviceInfo: payload.deviceInfo || "",
        createdAt: now,
        completedAt: now
    };

    sender.transactions.unshift({
        date: txDate,
        description: "Send Money to " + maskSendMoneyEmail(recipientEmail) + " (" + reference + ")",
        amount: currency === "USD" ? -totalDebit : 0
    });
    recipient.transactions.unshift({
        date: txDate,
        description: "Funds received from " + maskSendMoneyEmail(senderEmail) + " (" + reference + ")",
        amount: currency === "USD" ? amount : 0
    });

    pushAccountNotification(sender,
        "Transfer sent: " + amount + " " + currency + " to " + lookup.recipient.fullName + " — Ref " + reference,
        { type: "transfer" }
    );
    pushAccountNotification(recipient,
        "Funds received: " + amount + " " + currency + " from " + (sender.profile ? sender.profile.fullName : senderEmail) + " — Ref " + reference,
        { type: "transfer" }
    );

    sender.sendMoneyHistory.unshift(Object.assign({}, transfer, { direction: "sent" }));
    recipient.sendMoneyHistory.unshift(Object.assign({}, transfer, { direction: "received" }));

    saveAccount(senderEmail, sender);
    saveAccount(recipientEmail, recipient);

    const admin = getAdminData();
    if (!admin.internalTransfers) admin.internalTransfers = [];
    if (!admin.sendMoneyAuditLog) admin.sendMoneyAuditLog = [];
    admin.internalTransfers.unshift(transfer);
    admin.sendMoneyAuditLog.unshift({
        id: "audit-" + Date.now(),
        transferId: transfer.id,
        reference: reference,
        action: "transfer-completed",
        senderEmail: senderEmail,
        recipientEmail: recipientEmail,
        currency: currency,
        amount: amount,
        timestamp: now
    });
    saveAdminData(admin);

    return {
        ok: true,
        transfer: transfer,
        senderAccount: sender,
        recipientAccount: recipient,
        offline: true
    };
}

function submitSendMoneyAsync(payload) {
    payload = payload || {};
    if (!payload.senderEmail) {
        return Promise.resolve({ ok: false, error: "You must be logged in." });
    }

    if (!isServerSyncAvailable()) {
        return Promise.resolve(executeSendMoneyOffline(payload));
    }

    return registryFetch("/api/send-money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "send",
            senderEmail: payload.senderEmail,
            recipient: payload.recipient,
            currency: payload.currency,
            amount: payload.amount,
            note: payload.note,
            ipAddress: payload.ipAddress,
            deviceInfo: payload.deviceInfo,
            idempotencyKey: payload.idempotencyKey
        })
    })
        .then(function(response) { return response.json(); })
        .then(function(result) {
            if (!result.ok) return result;
            if (result.senderAccount) {
                applyServerAccountLocally(payload.senderEmail, result.senderAccount);
            }
            if (result.recipientAccount && result.transfer) {
                applyServerAccountLocally(result.transfer.recipientEmail, result.recipientAccount);
            }
            return result;
        })
        .catch(function(err) {
            return executeSendMoneyOffline(payload);
        });
}

function getSendMoneyHistory(email, filters) {
    filters = filters || {};
    const account = getAccount(email);
    if (!account) return [];
    let history = Array.isArray(account.sendMoneyHistory) ? account.sendMoneyHistory.slice() : [];

    if (filters.status && filters.status !== "all") {
        history = history.filter(function(item) { return item.status === filters.status; });
    }
    if (filters.period && filters.period !== "all") {
        const now = Date.now();
        const ranges = { today: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
        const ms = ranges[filters.period];
        if (ms) {
            history = history.filter(function(item) {
                return now - new Date(item.createdAt).getTime() <= ms;
            });
        }
    }
    return history;
}

function getAdminInternalTransfers() {
    const admin = getAdminData();
    return {
        transfers: admin.internalTransfers || [],
        auditLog: admin.sendMoneyAuditLog || []
    };
}

function reverseSendMoneyTransfer(transferId, reason) {
    const admin = getAdminData();
    const transfers = admin.internalTransfers || [];
    const transfer = transfers.find(function(entry) {
        return String(entry.id) === String(transferId);
    });
    if (!transfer) return { ok: false, error: "Transfer not found." };
    if (transfer.status === "reversed") return { ok: false, error: "Already reversed." };

    if (isServerSyncAvailable()) {
        return registryFetch("/api/send-money", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "reverse",
                transferId: transferId,
                reason: reason,
                adminId: "admin"
            })
        }).then(function(response) { return response.json(); });
    }

    const sender = getAccount(transfer.senderEmail);
    const recipient = getAccount(transfer.recipientEmail);
    if (!sender || !recipient) return { ok: false, error: "Accounts not found." };

    const currency = transfer.currency;
    const amount = Number(transfer.amount);
    const totalDebit = Number(transfer.totalDebit || amount);

    if (getSendMoneyBalance(recipient, currency) < amount) {
        return { ok: false, error: "Recipient has insufficient balance to reverse." };
    }

    applySendMoneyBalanceDelta(recipient, currency, -amount);
    applySendMoneyBalanceDelta(sender, currency, totalDebit);
    transfer.status = "reversed";
    transfer.reversedAt = new Date().toISOString();
    transfer.reverseReason = reason || "Reversed by admin";

    pushAccountNotification(sender, "Transfer reversed — Ref " + transfer.reference, { type: "transfer" });
    pushAccountNotification(recipient, "Transfer reversed — Ref " + transfer.reference, { type: "transfer" });

    saveAccount(transfer.senderEmail, sender);
    saveAccount(transfer.recipientEmail, recipient);
    saveAdminData(admin);

    return Promise.resolve({ ok: true, transfer: transfer, offline: true });
}
