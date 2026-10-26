/* GlobalVest OAuth (Google / Apple) via Supabase Auth */

let oauthConfigCache = null;

function fetchOAuthConfig() {
    if (oauthConfigCache) {
        return Promise.resolve(oauthConfigCache);
    }
    return fetch("/api/oauth-config", { cache: "no-store" })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            oauthConfigCache = data;
            return data;
        })
        .catch(function() {
            return { ok: false, configured: false };
        });
}

function createSupabaseAuthClient(config) {
    if (!config || !config.configured || !window.supabase) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
            flowType: "pkce",
            detectSessionInUrl: true,
            persistSession: false
        }
    });
}

function setOAuthButtonsLoading(loading) {
    document.querySelectorAll("[data-oauth-provider]").forEach(function(btn) {
        btn.disabled = loading || btn.dataset.oauthDisabled === "1";
        btn.classList.toggle("is-loading", loading);
    });
}

function showOAuthNotice(message) {
    const el = document.getElementById("oauthNotice");
    if (!el) return;
    if (!message) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
}

function applyOAuthAccountResult(result) {
    const email = typeof normalizeEmail === "function"
        ? normalizeEmail(result.email)
        : String(result.email || "").trim().toLowerCase();
    if (!email || !result.account) {
        throw new Error("Invalid OAuth response.");
    }

    if (typeof saveAccount === "function") {
        saveAccount(email, result.account, { skipServerSync: true });
    }
    if (typeof recordSuccessfulLogin === "function") {
        recordSuccessfulLogin(email);
    }
    if (typeof setSession === "function") {
        setSession(email, { skipServerSync: true });
    }
    sessionStorage.setItem("securebank_new_signup", result.isNew ? "1" : "");
    const dash = window.location.pathname.indexOf("/auth/") !== -1
        ? "../dashboard.html"
        : "dashboard.html";
    window.location.href = dash;
}

function postOAuthComplete(accessToken) {
    return fetch("/api/oauth-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken })
    }).then(function(r) {
        return r.json().then(function(data) {
            if (!r.ok || !data.ok) {
                throw new Error((data && data.error) || "OAuth sign-in failed.");
            }
            return data;
        });
    });
}

function startOAuthProvider(provider) {
    setOAuthButtonsLoading(true);
    showOAuthNotice("");

    fetchOAuthConfig().then(function(config) {
        if (!config.configured) {
            throw new Error(config.message || "OAuth is not configured yet.");
        }
        const client = createSupabaseAuthClient(config);
        if (!client) {
            throw new Error("Could not initialize OAuth client.");
        }
        const redirectTo = config.redirectTo ||
            (window.location.origin + "/auth/callback.html");

        return client.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: redirectTo,
                queryParams: provider === "apple"
                    ? { scope: "name email" }
                    : undefined
            }
        });
    }).then(function(result) {
        if (result.error) {
            throw result.error;
        }
        if (result.data && result.data.url) {
            window.location.href = result.data.url;
            return;
        }
        setOAuthButtonsLoading(false);
    }).catch(function(err) {
        setOAuthButtonsLoading(false);
        showOAuthNotice(err.message || "Could not start OAuth sign-in.");
    });
}

function initOAuthButtons() {
    fetchOAuthConfig().then(function(config) {
        const notice = config.configured
            ? ""
            : (config.message || "Google and Apple sign-in require Supabase OAuth configuration.");

        document.querySelectorAll("[data-oauth-provider]").forEach(function(btn) {
            if (!config.configured) {
                btn.dataset.oauthDisabled = "1";
                btn.disabled = true;
                btn.setAttribute("aria-disabled", "true");
            } else {
                btn.dataset.oauthDisabled = "0";
                btn.disabled = false;
                btn.removeAttribute("aria-disabled");
            }
            btn.addEventListener("click", function(e) {
                e.preventDefault();
                if (btn.disabled) return;
                startOAuthProvider(btn.dataset.oauthProvider);
            });
        });

        if (notice) showOAuthNotice(notice);
    });
}

function completeOAuthCallback() {
    const statusEl = document.getElementById("callbackStatus");
    function fail(msg) {
        if (statusEl) statusEl.textContent = msg;
    }

    fetchOAuthConfig().then(function(config) {
        if (!config.configured) {
            throw new Error("OAuth is not configured.");
        }
        const client = createSupabaseAuthClient(config);
        if (!client) throw new Error("OAuth client unavailable.");

        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
            return client.auth.exchangeCodeForSession(code).then(function(res) {
                if (res.error) throw res.error;
                return client.auth.getSession();
            });
        }
        return client.auth.getSession();
    }).then(function(sessionResult) {
        const session = sessionResult.data && sessionResult.data.session;
        if (!session || !session.access_token) {
            throw new Error("No OAuth session returned. Try signing in again.");
        }
        return postOAuthComplete(session.access_token);
    }).then(function(result) {
        applyOAuthAccountResult(result);
    }).catch(function(err) {
        fail(err.message || "Sign-in failed.");
        setTimeout(function() {
            window.location.href = "../login.html";
        }, 3200);
    });
}

document.addEventListener("DOMContentLoaded", function() {
    if (document.body.classList.contains("gv-auth-callback")) return;
    initOAuthButtons();
});
