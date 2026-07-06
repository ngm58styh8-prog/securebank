const fs = require("fs");
const path = require("path");

let schemaReady = false;
let schemaPromise = null;

function getMigrationSql() {
    const migrationPath = path.join(
        process.cwd(),
        "supabase",
        "migrations",
        "002_email_verifications_rls.sql"
    );
    return fs.readFileSync(migrationPath, "utf8");
}

function getDatabaseUrl() {
    const direct = (
        process.env.POSTGRES_URL_NON_POOLING ||
        process.env.POSTGRES_URL ||
        process.env.SUPABASE_DB_URL ||
        process.env.DATABASE_URL ||
        ""
    ).trim();

    if (direct) return direct;

    const host = (process.env.POSTGRES_HOST || process.env.SUPABASE_DB_HOST || "").trim();
    const user = (process.env.POSTGRES_USER || process.env.SUPABASE_DB_USER || "postgres").trim();
    const password = (process.env.POSTGRES_PASSWORD || process.env.SUPABASE_DB_PASSWORD || "").trim();
    const database = (process.env.POSTGRES_DATABASE || process.env.SUPABASE_DB_NAME || "postgres").trim();
    const port = (process.env.POSTGRES_PORT || "5432").trim();

    if (host && password) {
        return "postgresql://" + encodeURIComponent(user) + ":" + encodeURIComponent(password) +
            "@" + host + ":" + port + "/" + database + "?sslmode=require";
    }

    return "";
}

async function ensureVerificationSchema() {
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async function() {
        const connectionString = getDatabaseUrl();
        if (!connectionString) {
            schemaReady = true;
            return;
        }
        let Client;
        try {
            Client = require("pg").Client;
        } catch (e) {
            schemaReady = true;
            return;
        }

        const client = new Client({
            connectionString: connectionString,
            ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }
        });

        await client.connect();
        try {
            await client.query(getMigrationSql());
        } finally {
            await client.end();
        }

        schemaReady = true;
    })().catch(function(err) {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

module.exports = {
    ensureVerificationSchema,
    getDatabaseUrl,
    resetVerificationSchemaCache: function() {
        schemaReady = false;
        schemaPromise = null;
    }
};
