-- Internal Send Money audit table (optional relational log; primary store remains JSONB in user_accounts.account)
CREATE TABLE IF NOT EXISTS internal_transfers (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    sender_email TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    sender_wallet TEXT,
    recipient_wallet TEXT,
    transfer_method TEXT NOT NULL CHECK (transfer_method IN ('email', 'wallet')),
    currency TEXT NOT NULL,
    amount NUMERIC(20, 8) NOT NULL,
    fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    note TEXT,
    ip_address TEXT,
    device_info TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    reversed_at TIMESTAMPTZ,
    reversed_by TEXT,
    reverse_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_internal_transfers_sender ON internal_transfers(sender_email);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_recipient ON internal_transfers(recipient_email);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_reference ON internal_transfers(reference);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_created ON internal_transfers(created_at DESC);

ALTER TABLE internal_transfers ENABLE ROW LEVEL SECURITY;

-- Service role only (matches existing registry pattern)
CREATE POLICY internal_transfers_service_role ON internal_transfers
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
