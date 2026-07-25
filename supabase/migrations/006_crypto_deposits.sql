-- Cryptocurrency deposit audit log (primary queue remains admin_registry.admin.pendingDeposits JSONB)
CREATE TABLE IF NOT EXISTS crypto_deposits (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    currency TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    amount NUMERIC(20, 2) NOT NULL,
    crypto_amount NUMERIC(30, 10),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_deposits_user ON crypto_deposits(user_email);
CREATE INDEX IF NOT EXISTS idx_crypto_deposits_status ON crypto_deposits(status);
CREATE INDEX IF NOT EXISTS idx_crypto_deposits_created ON crypto_deposits(created_at DESC);

ALTER TABLE crypto_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY crypto_deposits_service_role ON crypto_deposits
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
