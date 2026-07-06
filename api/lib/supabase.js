const { createClient } = require("@supabase/supabase-js");

function getSupabaseAdmin() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }

    return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

module.exports = { getSupabaseAdmin };
