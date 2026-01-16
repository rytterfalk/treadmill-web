-- Add support for timed challenges (dead hang, plank, etc.)
-- is_timed: 0 = reps-based (default), 1 = time-based
-- target_seconds: target time for timed challenges (null for reps-based)
-- seconds: actual time logged for a set (null for reps-based)

ALTER TABLE daily_challenges ADD COLUMN is_timed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_challenges ADD COLUMN target_seconds INTEGER;

ALTER TABLE daily_challenge_sets ADD COLUMN seconds INTEGER;

