-- Gold Investment plans audit and payout log (primary state in user_accounts.account JSONB + admin_registry.admin JSONB)
CREATE TABLE IF NOT EXISTS gold_payouts (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    user_email TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    investment_id TEXT,
    amount NUMERIC(20, 2) NOT NULL,
    credit_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'reversed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_payouts_user_plan_date
    ON gold_payouts(user_email, plan_id, credit_date);

CREATE INDEX IF NOT EXISTS idx_gold_payouts_user ON gold_payouts(user_email);
CREATE INDEX IF NOT EXISTS idx_gold_payouts_created ON gold_payouts(created_at DESC);

ALTER TABLE gold_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY gold_payouts_service_role ON gold_payouts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
