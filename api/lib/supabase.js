const { createClient } = require("@supabase/supabase-js");
const {
    getSupabaseUrl,
    getValidatedServiceRoleKey,
    isSupabaseJwtKey,
    validateServiceRoleKey
} = require("./supabase-config");

function getSupabaseServiceRoleClient() {
    const url = getSupabaseUrl();
    const resolved = getValidatedServiceRoleKey();

    if (!url || !resolved.key) {
        throw new Error(
            "Supabase service role is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to a service_role JWT or sb_secret_ key."
        );
    }

    const serviceRoleKey = validateServiceRoleKey(resolved.key, resolved.source);
    const options = {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    };

    if (isSupabaseJwtKey(serviceRoleKey)) {
        options.global = {
            headers: {
                Authorization: "Bearer " + serviceRoleKey
            }
        };
    }

    return createClient(url, serviceRoleKey, options);
}

module.exports = {
    getSupabaseServiceRoleClient,
    getSupabaseAdmin: getSupabaseServiceRoleClient
};
