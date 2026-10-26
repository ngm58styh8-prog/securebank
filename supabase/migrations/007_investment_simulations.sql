-- Investment simulation audit (primary state remains in user_accounts JSONB + admin_registry)

CREATE TABLE IF NOT EXISTS investment_simulation_events (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    user_email TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    plan_id TEXT,
    position_id TEXT,
    amount NUMERIC(20, 2) NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'simulated_credit',
    notification_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS investment_admin_audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor_email TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_sim_events_user ON investment_simulation_events(user_email);
CREATE INDEX IF NOT EXISTS idx_inv_sim_events_created ON investment_simulation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_admin_audit_created ON investment_admin_audit_logs(created_at DESC);

ALTER TABLE investment_simulation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY investment_simulation_events_service ON investment_simulation_events
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY investment_admin_audit_service ON investment_admin_audit_logs
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
