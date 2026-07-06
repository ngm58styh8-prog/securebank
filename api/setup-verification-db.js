const { setCors, handleOptions } = require("./lib/cors");
const {
    ensureVerificationSchema,
    resetVerificationSchemaCache,
    getDatabaseUrl
} = require("./lib/verification-schema");
const fs = require("fs");
const path = require("path");

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    setCors(res);

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }

    try {
        if (!getDatabaseUrl()) {
            throw new Error("Database connection is not configured on Vercel.");
        }

        resetVerificationSchemaCache();
        await ensureVerificationSchema();

        res.status(200).json({
            ok: true,
            message: "Verification database policy applied."
        });
    } catch (err) {
        const migrationPath = path.join(process.cwd(), "supabase", "migrations", "002_email_verifications_rls.sql");
        const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";

        res.status(500).json({
            ok: false,
            error: err.message || "Failed to apply verification database policy.",
            postgresConfigured: !!getDatabaseUrl(),
            manualSql: sql
        });
    }
};
