const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
    getSupabaseUrl,
    getSupabaseAnonKey,
    isOAuthConfigured
} = require("./supabase-config");
const {
    normalizeRegistryEmail,
    loadAllAccounts,
    registerUserAccount
} = require("./registry");

function buildOAuthStarterAccount(fullName, email, provider, providerId) {
    const now = new Date().toISOString();
    return {
        cash: 0,
        holdings: {
            btc: 0, eth: 0, sol: 0, xrp: 0,
            gold: 0, aapl: 0, googl: 0, msft: 0, nvda: 0,
            spy: 0, qqq: 0, vti: 0
        },
        transactions: [],
        notifications: [{
            id: Date.now(),
            message: "Welcome to GlobalVest — signed in with " + provider,
            time: now,
            read: false
        }],
        emails: [],
        password: crypto.randomBytes(24).toString("hex"),
        passwordUpdatedAt: now,
        emailVerified: true,
        knownDevices: [],
        settings: {
            theme: "dark",
            currency: "USD",
            language: "en",
            twoFactorEnabled: false
        },
        profile: {
            fullName: fullName,
            email: email,
            phone: "0000000000",
            country: "US",
            memberSince: now,
            verificationStatus: "Pending",
            ssnLast4: null,
            oauthProviders: {}
        }
    };
}

function extractOAuthIdentity(user) {
    const identities = user.identities || [];
    const oauthIdentity = identities.find(function(id) {
        return id.provider === "google" || id.provider === "apple";
    });
    if (oauthIdentity) {
        return {
            provider: oauthIdentity.provider,
            providerId: String(oauthIdentity.id || user.id || "")
        };
    }
    const provider = user.app_metadata && user.app_metadata.provider;
    if (provider === "google" || provider === "apple") {
        return { provider: provider, providerId: String(user.id || "") };
    }
    return null;
}

async function verifyOAuthAccessToken(accessToken) {
    if (!isOAuthConfigured()) {
        throw new Error("OAuth is not configured on the server.");
    }
    const url = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error) {
        throw new Error(error.message || "Invalid OAuth session.");
    }
    if (!data || !data.user || !data.user.email) {
        throw new Error("OAuth provider did not return an email address.");
    }
    return data.user;
}

async function completeOAuthSignIn(accessToken) {
    const user = await verifyOAuthAccessToken(accessToken);
    const identity = extractOAuthIdentity(user);
    if (!identity || !identity.providerId) {
        throw new Error("Unsupported OAuth provider.");
    }

    const email = normalizeRegistryEmail(user.email);
    const fullName = String(
        (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
        email.split("@")[0]
    ).trim();

    const accounts = await loadAllAccounts();
    let account = accounts[email];
    const provider = identity.provider;
    const providerId = identity.providerId;

    if (account && typeof account === "object") {
        const profile = account.profile && typeof account.profile === "object"
            ? account.profile
            : {};
        const oauthProviders = profile.oauthProviders && typeof profile.oauthProviders === "object"
            ? profile.oauthProviders
            : {};

        if (oauthProviders[provider]) {
            if (String(oauthProviders[provider]) !== providerId) {
                return {
                    ok: false,
                    error: "This email is linked to a different " + provider + " account."
                };
            }
        } else {
            return {
                ok: false,
                error: "An account with this email already exists. Sign in with email and password, or use a different email."
            };
        }

        profile.lastLoginAt = new Date().toISOString();
        account.profile = profile;
        await registerUserAccount(email, account, { eventType: "login" });
        return { ok: true, email: email, account: account, isNew: false, provider: provider };
    }

    account = buildOAuthStarterAccount(fullName, email, provider, providerId);
    account.profile.oauthProviders[provider] = providerId;

    await registerUserAccount(email, account, { eventType: "signup", logSignup: true });
    return { ok: true, email: email, account: account, isNew: true, provider: provider };
}

function getOAuthPublicConfig(origin) {
    const configured = isOAuthConfigured();
    const redirectBase = String(origin || "").replace(/\/$/, "");
    return {
        ok: true,
        configured: configured,
        supabaseUrl: configured ? getSupabaseUrl() : null,
        supabaseAnonKey: configured ? getSupabaseAnonKey() : null,
        providers: {
            google: configured,
            apple: configured
        },
        redirectTo: redirectBase ? redirectBase + "/auth/callback.html" : null,
        message: configured
            ? "OAuth ready when Google and Apple are enabled in Supabase Auth."
            : "Set SUPABASE_URL and SUPABASE_ANON_KEY (publishable) on the server to enable Google and Apple sign-in."
    };
}

module.exports = {
    completeOAuthSignIn,
    getOAuthPublicConfig,
    isOAuthConfigured
};
