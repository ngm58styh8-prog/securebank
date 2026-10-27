-- Investment confirmation email queue, delivery tracking and idempotency.
-- One row per (investment_id, notification_type). Rows are written by the server
-- with the service role only; retries re-use the same row so an investment is never duplicated.
CREATE TABLE IF NOT EXISTS investment_email_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    investment_id TEXT NOT NULL,
    notification_type TEXT NOT NULL DEFAULT 'investment_confirmation',
    user_email TEXT NOT NULL,
    customer_name TEXT,
    asset_id TEXT,
    asset_name TEXT NOT NULL,
    investment_reference TEXT NOT NULL,
    plan_name TEXT,
    simulated BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'deferred', 'failed', 'bounced', 'complained')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ,
    provider TEXT NOT NULL DEFAULT 'resend',
    provider_message_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    admin_alerted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_email_due
    ON investment_email_notifications (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_investment_email_user
    ON investment_email_notifications (user_email);
CREATE INDEX IF NOT EXISTS idx_investment_email_provider_id
    ON investment_email_notifications (provider_message_id);
CREATE INDEX IF NOT EXISTS idx_investment_email_created
    ON investment_email_notifications (created_at DESC);

ALTER TABLE investment_email_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investment_email_notifications_service_role ON investment_email_notifications;
CREATE POLICY investment_email_notifications_service_role ON investment_email_notifications
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
