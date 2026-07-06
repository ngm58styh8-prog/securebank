const { createClient } = require("@supabase/supabase-js");
const { getSupabaseUrl, getSupabaseAdminKey } = require("./supabase-config");

function getSupabaseAdmin() {
    const url = getSupabaseUrl();
    const admin = getSupabaseAdminKey();

    if (!url || !admin.key) {
        throw new Error(
            "Supabase is not configured. Set SUPABASE_URL and one of SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY."
        );
    }

    return createClient(url, admin.key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

module.exports = { getSupabaseAdmin };
