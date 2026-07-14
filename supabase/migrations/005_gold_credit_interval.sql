-- Allow multiple gold payouts per day (3-minute demo credit interval)
DROP INDEX IF EXISTS idx_gold_payouts_user_plan_date;
