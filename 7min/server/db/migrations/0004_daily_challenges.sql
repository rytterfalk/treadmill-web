-- Daily challenges with multi-user leaderboard support

CREATE TABLE IF NOT EXISTS daily_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  exercise TEXT NOT NULL,
  target_reps INTEGER NOT NULL DEFAULT 10,
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_challenge_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  retroactive INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (challenge_id) REFERENCES daily_challenges(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_challenges_date ON daily_challenges(date);
CREATE INDEX IF NOT EXISTS idx_daily_challenges_user_date ON daily_challenges(user_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_challenge_sets_challenge ON daily_challenge_sets(challenge_id);

