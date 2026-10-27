-- Deposit workflow: audit columns + restore production wallet addresses when still on demo placeholders.
-- Backup: production admin_registry row is updated in-place only when demo addresses are detected.

ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';
ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS reject_reason TEXT;

UPDATE admin_registry
SET admin = jsonb_set(
    jsonb_set(
        admin,
        '{cryptoDepositWallets}',
        '[
            {"symbol":"BTC","name":"Bitcoin","network":"Bitcoin Mainnet","address":"1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2"},
            {"symbol":"ETH","name":"Ethereum","network":"Ethereum Mainnet","address":"0xC3eFfb72DFE7296e29c386c1C366b42Adb7E857F"}
        ]'::jsonb,
        true
    ),
    '{walletAddress}',
    '"1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2"'::jsonb,
    true
)
WHERE id = 'default'
  AND admin->'cryptoDepositWallets'->0->>'address' = 'DEMO-BTC-ADDRESS-DO-NOT-SEND-FUNDS';
