const { createClient } = require("@supabase/supabase-js");
const { getSupabaseUrl, getValidatedSupabaseAdminKey, isSupabaseJwtKey } = require("./supabase-config");

function getSupabaseAdmin() {
    const url = getSupabaseUrl();
    const admin = getValidatedSupabaseAdminKey();

    if (!url || !admin.key) {
        throw new Error(
            "Supabase is not configured. Set SUPABASE_URL and one of SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY."
        );
    }

    const options = {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    };

    if (isSupabaseJwtKey(admin.key)) {
        options.global = {
            headers: {
                Authorization: "Bearer " + admin.key
            }
        };
    }

    return createClient(url, admin.key, options);
}

module.exports = { getSupabaseAdmin };
