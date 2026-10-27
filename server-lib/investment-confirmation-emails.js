const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const emailConfig = require("./email-config.json");
const { sendTransactionalEmail } = require("./resend");
const {
    getFromAddress,
    getReplyTo,
    getSiteUrl,
    buildTransactionalHeaders,
    buildTransactionalEmailContent
} = require("./email-deliverability");
const {
    SUBJECT,
    SENDER_DISPLAY_NAME,
    buildInvestmentConfirmationEmail
} = require("./investment-confirmation-template");
const { getSupabaseServiceRoleClient } = require("./supabase");

const TABLE = "investment_email_notifications";
const NOTIFICATION_TYPE = "investment_confirmation";
const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60];
const LOCK_MS = 5 * 60 * 1000;
const LOCAL_STORE_PATH = path.join(
    process.env.GLOBALVEST_DATA_DIR || path.join(__dirname, "..", "data"),
    "investment-emails.json"
);

const STATUS_LABELS = {
    queued: "Queued",
    sending: "Sending",
    sent: "Sent",
    delivered: "Delivered",
    deferred: "Deferred",
    failed: "Failed",
    bounced: "Bounced",
    complained: "Complained"
};

// Higher rank wins when provider webhooks arrive out of order.
const STATUS_RANK = {
    queued: 0,
    sending: 1,
    sent: 2,
    deferred: 3,
    delivered: 4,
    failed: 5,
    bounced: 6,
    complained: 7
};

const TEMPORARY_ERROR_CODES = [
    "rate_limit_exceeded",
    "daily_quota_exceeded",
    "monthly_quota_exceeded",
    "application_error",
    "internal_server_error",
    "concurrent_idempotent_requests",
    "network_error",
    "not_configured"
];

function nowIso() {
    return new Date().toISOString();
}

function cleanEnv(value) {
    return String(value || "").trim();
}

function useLocalStore() {
    const flag = cleanEnv(process.env.USE_LOCAL_REGISTRY).toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") return true;
    try {
        getSupabaseServiceRoleClient();
        return false;
    } catch (e) {
        return true;
    }
}

/* ------------------------------------------------------------------ */
/* Sender                                                              */
/* ------------------------------------------------------------------ */

function getVerifiedSendingDomain() {
    return String(emailConfig.fromEmail.split("@")[1] || "").toLowerCase();
}

function getInvestmentSender() {
    const domain = getVerifiedSendingDomain();
    const configured = cleanEnv(process.env.INVESTMENT_EMAIL_FROM);
    const candidate = configured || (SENDER_DISPLAY_NAME + " <investments@" + domain + ">");
    const match = candidate.match(/<([^>]+)>/);
    const address = String(match ? match[1] : candidate).trim().toLowerCase();
    const candidateDomain = address.split("@")[1] || "";

    if (candidateDomain !== domain) {
        return {
            from: getFromAddress(),
            usingFallback: true,
            warning: "Investment sender domain (" + candidateDomain + ") is not the verified domain (" + domain +
                "). Falling back to the default verified sender."
        };
    }
    return { from: candidate, usingFallback: false, warning: null };
}

/* ------------------------------------------------------------------ */
/* Storage (Supabase table, JSON file for local development)           */
/* ------------------------------------------------------------------ */

function readLocalRows() {
    try {
        if (!fs.existsSync(LOCAL_STORE_PATH)) return [];
        const data = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf8"));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

function writeLocalRows(rows) {
    fs.mkdirSync(path.dirname(LOCAL_STORE_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(rows, null, 2));
}

function storeError(error) {
    const message = error && error.message ? error.message : String(error);
    if (/relation .* does not exist|schema cache|Could not find the table/i.test(message)) {
        return new Error(
            "Table investment_email_notifications is missing. Run supabase/migrations/008_investment_email_notifications.sql."
        );
    }
    return new Error(message);
}

const store = {
    async insert(row) {
        if (useLocalStore()) {
            const rows = readLocalRows();
            const existing = rows.find(function(r) { return r.idempotency_key === row.idempotency_key; });
            if (existing) return { row: existing, duplicate: true };
            rows.unshift(row);
            writeLocalRows(rows);
            return { row: row, duplicate: false };
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase.from(TABLE).insert(row).select().single();
        if (error) {
            if (error.code === "23505") {
                const existing = await store.getByKey(row.idempotency_key);
                return { row: existing, duplicate: true };
            }
            throw storeError(error);
        }
        return { row: data, duplicate: false };
    },

    async getById(id) {
        if (useLocalStore()) {
            return readLocalRows().find(function(r) { return r.id === id; }) || null;
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
        if (error) throw storeError(error);
        return data || null;
    },

    async getByKey(key) {
        if (useLocalStore()) {
            return readLocalRows().find(function(r) { return r.idempotency_key === key; }) || null;
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase.from(TABLE).select("*").eq("idempotency_key", key).maybeSingle();
        if (error) throw storeError(error);
        return data || null;
    },

    async getByProviderId(providerId) {
        if (!providerId) return null;
        if (useLocalStore()) {
            return readLocalRows().find(function(r) { return r.provider_message_id === providerId; }) || null;
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase
            .from(TABLE)
            .select("*")
            .eq("provider_message_id", providerId)
            .limit(1);
        if (error) throw storeError(error);
        return data && data.length ? data[0] : null;
    },

    async update(id, patch) {
        const withTime = Object.assign({}, patch, { updated_at: nowIso() });
        if (useLocalStore()) {
            const rows = readLocalRows();
            const idx = rows.findIndex(function(r) { return r.id === id; });
            if (idx < 0) return null;
            rows[idx] = Object.assign({}, rows[idx], withTime);
            writeLocalRows(rows);
            return rows[idx];
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase.from(TABLE).update(withTime).eq("id", id).select().maybeSingle();
        if (error) throw storeError(error);
        return data || null;
    },

    /**
     * Atomically moves a queued row to "sending". Returns the claimed row, or null if
     * another worker already claimed it or it is not due.
     */
    async claim(id, options) {
        options = options || {};
        const current = await store.getById(id);
        if (!current || current.status !== "queued") return null;
        if (!options.ignoreSchedule && new Date(current.next_attempt_at).getTime() > Date.now()) return null;

        const patch = {
            status: "sending",
            attempts: Number(current.attempts || 0) + 1,
            locked_until: new Date(Date.now() + LOCK_MS).toISOString(),
            updated_at: nowIso()
        };

        if (useLocalStore()) {
            return store.update(id, patch);
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase
            .from(TABLE)
            .update(patch)
            .eq("id", id)
            .eq("status", "queued")
            .eq("attempts", Number(current.attempts || 0))
            .select();
        if (error) throw storeError(error);
        return data && data.length ? data[0] : null;
    },

    async listDueIds(limit) {
        const cutoff = nowIso();
        if (useLocalStore()) {
            return readLocalRows()
                .filter(function(r) { return r.status === "queued" && r.next_attempt_at <= cutoff; })
                .slice(0, limit)
                .map(function(r) { return r.id; });
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase
            .from(TABLE)
            .select("id")
            .eq("status", "queued")
            .lte("next_attempt_at", cutoff)
            .order("next_attempt_at", { ascending: true })
            .limit(limit);
        if (error) throw storeError(error);
        return (data || []).map(function(r) { return r.id; });
    },

    /** Re-queues rows whose worker died mid-send. Safe because the Resend idempotency key is reused. */
    async releaseStaleLocks() {
        const cutoff = nowIso();
        if (useLocalStore()) {
            const rows = readLocalRows();
            let released = 0;
            rows.forEach(function(r) {
                if (r.status === "sending" && r.locked_until && r.locked_until < cutoff) {
                    r.status = "queued";
                    r.locked_until = null;
                    released += 1;
                }
            });
            if (released) writeLocalRows(rows);
            return released;
        }
        const supabase = getSupabaseServiceRoleClient();
        const { data, error } = await supabase
            .from(TABLE)
            .update({ status: "queued", locked_until: null, updated_at: cutoff })
            .eq("status", "sending")
            .lt("locked_until", cutoff)
            .select("id");
        if (error) throw storeError(error);
        return data ? data.length : 0;
    },

    async list(filters) {
        filters = filters || {};
        const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
        if (useLocalStore()) {
            let rows = readLocalRows();
            if (filters.status) rows = rows.filter(function(r) { return r.status === filters.status; });
            return rows.slice(0, limit);
        }
        const supabase = getSupabaseServiceRoleClient();
        let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false }).limit(limit);
        if (filters.status) query = query.eq("status", filters.status);
        const { data, error } = await query;
        if (error) throw storeError(error);
        return data || [];
    }
};

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

function roundCents(value) {
    return Math.round(Number(value) * 100) / 100;
}

/**
 * Projected figures are derived from the plan terms stored with the investment.
 * hourly = daily / 24, total = daily x plan duration.
 */
function buildProjection(input) {
    const amount = roundCents(input.amount);
    const durationDays = Math.max(0, Math.floor(Number(input.durationDays) || 0));
    const dailyReturn = roundCents(input.dailyReturn);
    const totalEarnings = roundCents(dailyReturn * durationDays);
    const start = new Date(input.startDate || Date.now());
    const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
    return {
        amount: amount,
        dailyReturn: dailyReturn,
        hourlyEarnings: dailyReturn / 24,
        durationDays: durationDays,
        totalEarnings: totalEarnings,
        totalValue: roundCents(amount + totalEarnings),
        startDate: start.toISOString(),
        endDate: end.toISOString()
    };
}

function buildViewUrl(investmentId) {
    return getSiteUrl() + "/investments.html?investment=" + encodeURIComponent(investmentId);
}

function generateInvestmentReference(date) {
    const d = date ? new Date(date) : new Date();
    const stamp = d.toISOString().slice(0, 10).replace(/-/g, "");
    return "GV-INV-" + stamp + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function idempotencyKeyFor(investmentId, type) {
    return String(investmentId) + ":" + (type || NOTIFICATION_TYPE);
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

function isTemporaryError(err) {
    const code = String(err && err.code || "");
    const status = Number(err && err.statusCode);
    if (status === 429 || status >= 500) return true;
    return TEMPORARY_ERROR_CODES.indexOf(code) !== -1;
}

function retryDelayMs(attemptNumber) {
    const idx = Math.min(Math.max(attemptNumber - 1, 0), RETRY_BACKOFF_MINUTES.length - 1);
    return RETRY_BACKOFF_MINUTES[idx] * 60 * 1000;
}

function sanitizeError(err) {
    const message = String(err && err.message ? err.message : err || "Unknown error");
    return message.replace(/re_[A-Za-z0-9_]{10,}/g, "re_***").slice(0, 500);
}

async function alertAdmins(row, reason) {
    const recipients = cleanEnv(process.env.INVESTMENT_EMAIL_ADMIN_ALERT_TO)
        .split(",")
        .map(function(e) { return e.trim().toLowerCase(); })
        .filter(function(e) { return e.indexOf("@") > 0; });

    console.error("[investment-email] delivery failed permanently", {
        id: row.id,
        investment: row.investment_id,
        reference: row.investment_reference,
        reason: reason
    });

    if (!recipients.length) return false;

    const body =
        "An investment confirmation email could not be delivered after " + row.attempts + " attempt(s).\n\n" +
        "Investment reference: " + row.investment_reference + "\n" +
        "Customer: " + (row.customer_name || "—") + " <" + row.user_email + ">\n" +
        "Asset: " + row.asset_name + "\n" +
        "Failure reason: " + reason + "\n\n" +
        "The investment itself was not affected. Review and retry it from the admin dashboard under Investment Email Notifications.";

    let alerted = false;
    for (let i = 0; i < recipients.length; i++) {
        try {
            const wrapped = buildTransactionalEmailContent(
                "GlobalVest Admin | Investment email delivery failed",
                body,
                recipients[i],
                { category: "admin_alert", headline: "Investment email delivery failed" }
            );
            await sendTransactionalEmail({
                to: recipients[i],
                subject: wrapped.subject,
                text: wrapped.text,
                html: wrapped.html,
                headers: wrapped.headers,
                tags: wrapped.tags
            });
            alerted = true;
        } catch (err) {
            console.error("[investment-email] admin alert failed", sanitizeError(err));
        }
    }
    return alerted;
}

async function markFailed(row, reason) {
    const failedRow = await store.update(row.id, {
        status: "failed",
        failed_at: nowIso(),
        locked_until: null,
        last_error: reason
    });
    const alerted = await alertAdmins(failedRow || row, reason);
    if (alerted) {
        await store.update(row.id, { admin_alerted_at: nowIso() });
    }
    return failedRow;
}

/**
 * Sends one claimed notification. Never throws; the outcome is recorded on the row.
 */
async function deliverClaimedRow(row) {
    const payload = row.payload || {};
    let data;
    try {
        const content = buildInvestmentConfirmationEmail(payload);
        const sender = getInvestmentSender();
        if (sender.warning) console.warn("[investment-email]", sender.warning);

        const headers = buildTransactionalHeaders(row.user_email, row.investment_reference);
        const retryGeneration = Number(payload.retryGeneration || 0);
        const idempotencyKey = row.idempotency_key + (retryGeneration ? ":r" + retryGeneration : "");

        data = await sendTransactionalEmail({
            to: row.user_email,
            from: sender.from,
            replyTo: getReplyTo(),
            subject: content.subject,
            text: content.text,
            html: content.html,
            headers: headers,
            idempotencyKey: idempotencyKey,
            tags: [
                { name: "category", value: NOTIFICATION_TYPE },
                { name: "notification_id", value: row.id },
                { name: "environment", value: "production" }
            ]
        });
    } catch (err) {
        const reason = sanitizeError(err);
        const attempts = Number(row.attempts || 1);
        const maxAttempts = Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS);

        if (!isTemporaryError(err) || attempts >= maxAttempts) {
            return markFailed(row, reason);
        }
        return store.update(row.id, {
            status: "queued",
            next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
            locked_until: null,
            last_error: reason
        });
    }

    // A provider webhook can land before this write; never downgrade a later status.
    const latest = await store.getById(row.id);
    const patch = {
        provider_message_id: data && data.id ? data.id : null,
        sent_at: (latest && latest.sent_at) || nowIso(),
        locked_until: null,
        last_error: null
    };
    if (!latest || latest.status === "sending") patch.status = "sent";
    return store.update(row.id, patch);
}

async function attemptDelivery(id, options) {
    const claimed = await store.claim(id, options);
    if (!claimed) {
        return { attempted: false, row: await store.getById(id) };
    }
    const row = await deliverClaimedRow(claimed);
    return { attempted: true, row: row };
}

async function processDueNotifications(options) {
    options = options || {};
    const limit = Math.min(Number(options.limit) || 25, 100);
    const deadline = Date.now() + (Number(options.budgetMs) || 22000);
    const released = await store.releaseStaleLocks();
    const ids = await store.listDueIds(limit);
    const summary = { released: released, due: ids.length, sent: 0, requeued: 0, failed: 0, skipped: 0 };

    for (let i = 0; i < ids.length; i++) {
        if (Date.now() > deadline) break;
        const result = await attemptDelivery(ids[i]);
        if (!result.attempted) {
            summary.skipped += 1;
        } else if (result.row && result.row.status === "sent") {
            summary.sent += 1;
        } else if (result.row && result.row.status === "failed") {
            summary.failed += 1;
        } else {
            summary.requeued += 1;
        }
    }
    return Object.assign({ ok: true }, summary);
}

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

/**
 * Queues the confirmation for a committed investment and makes a first delivery attempt.
 * Idempotent on investment_id + notification_type; never throws.
 */
async function enqueueInvestmentConfirmation(input) {
    try {
        input = input || {};
        const email = String(input.email || "").trim().toLowerCase();
        const investmentId = String(input.investmentId || "").trim();

        if (input.paymentStatus && String(input.paymentStatus).toLowerCase() !== "completed") {
            return { ok: true, skipped: true, reason: "Payment is not completed." };
        }
        if (!investmentId || !input.reference) {
            return { ok: false, error: "Missing investment id or reference." };
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { ok: false, error: "Invalid customer email." };
        }

        const projection = buildProjection(input);
        const key = idempotencyKeyFor(investmentId, NOTIFICATION_TYPE);
        const createdAt = nowIso();
        const unverified = input.emailVerified === false;

        const row = {
            id: crypto.randomUUID(),
            idempotency_key: key,
            investment_id: investmentId,
            notification_type: NOTIFICATION_TYPE,
            user_email: email,
            customer_name: input.customerName || null,
            asset_id: input.assetId || null,
            asset_name: String(input.assetName || "Investment"),
            investment_reference: String(input.reference),
            plan_name: input.planName || null,
            simulated: input.simulated !== false,
            status: unverified ? "failed" : "queued",
            attempts: 0,
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            next_attempt_at: createdAt,
            locked_until: null,
            provider: "resend",
            provider_message_id: null,
            payload: {
                customerName: input.customerName || null,
                assetName: String(input.assetName || "Investment"),
                reference: String(input.reference),
                planName: input.planName || null,
                simulated: input.simulated !== false,
                viewUrl: buildViewUrl(investmentId),
                amount: projection.amount,
                dailyReturn: projection.dailyReturn,
                hourlyEarnings: projection.hourlyEarnings,
                durationDays: projection.durationDays,
                totalEarnings: projection.totalEarnings,
                totalValue: projection.totalValue,
                startDate: projection.startDate,
                endDate: projection.endDate,
                retryGeneration: 0
            },
            last_error: unverified ? "Recipient email address is not verified; confirmation not sent." : null,
            failed_at: unverified ? createdAt : null,
            queued_at: createdAt,
            created_at: createdAt,
            updated_at: createdAt
        };

        const inserted = await store.insert(row);
        if (inserted.duplicate) {
            return { ok: true, duplicate: true, notificationId: inserted.row.id, status: inserted.row.status };
        }
        if (unverified) {
            return { ok: true, skipped: true, notificationId: row.id, status: "failed", reason: row.last_error };
        }

        const delivery = await attemptDelivery(row.id);
        return {
            ok: true,
            notificationId: row.id,
            status: delivery.row ? delivery.row.status : "queued"
        };
    } catch (err) {
        console.error("[investment-email] enqueue failed", sanitizeError(err));
        return { ok: false, error: sanitizeError(err) };
    }
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

function toAdminView(row) {
    return {
        id: row.id,
        customerName: row.customer_name || "—",
        customerEmail: row.user_email,
        asset: row.asset_name,
        reference: row.investment_reference,
        investmentId: row.investment_id,
        emailType: "Investment Confirmation",
        status: row.status,
        statusLabel: STATUS_LABELS[row.status] || row.status,
        simulated: !!row.simulated,
        attempts: Number(row.attempts || 0),
        maxAttempts: Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS),
        nextAttemptAt: row.status === "queued" ? row.next_attempt_at : null,
        queuedAt: row.queued_at,
        sentAt: row.sent_at,
        deliveredAt: row.delivered_at,
        failureReason: row.last_error && ["failed", "bounced", "complained", "queued", "deferred"].indexOf(row.status) !== -1
            ? row.last_error
            : null,
        providerMessageId: row.provider_message_id,
        canRetry: row.status === "failed" && !/not verified/i.test(row.last_error || "")
    };
}

async function listInvestmentEmails(filters) {
    filters = filters || {};
    const rows = await store.list({ status: filters.status, limit: filters.limit });
    const q = String(filters.q || "").trim().toLowerCase();
    const filtered = q
        ? rows.filter(function(r) {
            return [r.user_email, r.customer_name, r.asset_name, r.investment_reference]
                .join(" ")
                .toLowerCase()
                .indexOf(q) !== -1;
        })
        : rows;
    const counts = {};
    rows.forEach(function(r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    return {
        ok: true,
        notifications: filtered.map(toAdminView),
        counts: counts,
        sender: getInvestmentSender().from
    };
}

/**
 * Re-queues a failed notification. Re-uses the same row (and investment), so no duplicate
 * investment or duplicate confirmation can be created. A new retry generation changes the
 * provider idempotency key so Resend treats it as a fresh send.
 */
async function retryInvestmentEmail(id, options) {
    options = options || {};
    const row = await store.getById(id);
    if (!row) return { ok: false, error: "Notification not found." };
    if (row.status !== "failed") {
        return { ok: false, error: "Only failed notifications can be retried (current status: " + row.status + ")." };
    }
    if (row.last_error && /not verified/i.test(row.last_error)) {
        return { ok: false, error: "Recipient email address is not verified; retry is not allowed." };
    }

    const payload = Object.assign({}, row.payload || {}, {
        retryGeneration: Number((row.payload || {}).retryGeneration || 0) + 1
    });
    await store.update(id, {
        status: "queued",
        attempts: 0,
        next_attempt_at: nowIso(),
        failed_at: null,
        admin_alerted_at: null,
        payload: payload
    });

    const delivery = options.deferDelivery ? { row: await store.getById(id) } : await attemptDelivery(id);
    return { ok: true, notification: toAdminView(delivery.row || (await store.getById(id))) };
}

/* ------------------------------------------------------------------ */
/* Provider webhooks (Resend / Svix)                                   */
/* ------------------------------------------------------------------ */

function verifyWebhookSignature(rawBody, headers, secret, toleranceSeconds) {
    const id = headers["svix-id"];
    const timestamp = headers["svix-timestamp"];
    const signatureHeader = headers["svix-signature"];
    if (!secret) return { ok: false, error: "Webhook secret is not configured." };
    if (!id || !timestamp || !signatureHeader) return { ok: false, error: "Missing signature headers." };

    const ts = Number(timestamp);
    const tolerance = toleranceSeconds == null ? 300 : toleranceSeconds;
    if (!isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > tolerance) {
        return { ok: false, error: "Timestamp outside tolerance." };
    }

    const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
    const expected = crypto
        .createHmac("sha256", key)
        .update(id + "." + timestamp + "." + rawBody)
        .digest("base64");

    const candidates = String(signatureHeader).split(" ").map(function(part) {
        const pieces = part.split(",");
        return pieces[0] === "v1" ? pieces[1] : null;
    }).filter(Boolean);

    const expectedBuf = Buffer.from(expected);
    const valid = candidates.some(function(candidate) {
        const candBuf = Buffer.from(candidate);
        return candBuf.length === expectedBuf.length && crypto.timingSafeEqual(candBuf, expectedBuf);
    });
    return valid ? { ok: true } : { ok: false, error: "Invalid signature." };
}

const EVENT_TO_STATUS = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "deferred",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.failed": "failed"
};

async function applyProviderEvent(event) {
    event = event || {};
    const status = EVENT_TO_STATUS[event.type];
    if (!status) return { ok: true, ignored: true, reason: "Unhandled event type." };

    const data = event.data || {};
    let row = await store.getByProviderId(data.email_id);
    if (!row) {
        const tags = data.tags || {};
        const notificationId = Array.isArray(tags)
            ? (tags.find(function(t) { return t && t.name === "notification_id"; }) || {}).value
            : tags.notification_id;
        if (notificationId) row = await store.getById(notificationId);
    }
    if (!row) return { ok: true, ignored: true, reason: "No matching notification." };

    const eventTime = event.created_at || data.created_at || nowIso();
    const patch = { provider_message_id: row.provider_message_id || data.email_id || null };

    if (STATUS_RANK[status] > STATUS_RANK[row.status] || status === row.status) {
        patch.status = status;
    }
    if (status === "delivered") patch.delivered_at = eventTime;
    if (status === "sent" && !row.sent_at) patch.sent_at = eventTime;
    if (status === "bounced" || status === "complained" || status === "failed" || status === "deferred") {
        const detail = (data.bounce && (data.bounce.message || data.bounce.type)) ||
            (data.failed && data.failed.reason) ||
            data.reason ||
            (status === "complained" ? "Recipient marked the message as spam." : null) ||
            (status === "deferred" ? "Delivery delayed by recipient mail server." : null) ||
            ("Provider reported " + status + ".");
        patch.last_error = String(detail).slice(0, 500);
        if (status !== "deferred") patch.failed_at = eventTime;
    }

    const updated = await store.update(row.id, patch);
    return { ok: true, notificationId: row.id, status: updated ? updated.status : row.status };
}

module.exports = {
    NOTIFICATION_TYPE,
    SUBJECT,
    STATUS_LABELS,
    buildProjection,
    buildViewUrl,
    generateInvestmentReference,
    idempotencyKeyFor,
    getInvestmentSender,
    enqueueInvestmentConfirmation,
    processDueNotifications,
    listInvestmentEmails,
    retryInvestmentEmail,
    verifyWebhookSignature,
    applyProviderEvent,
    isTemporaryError,
    store,
    LOCAL_STORE_PATH
};
