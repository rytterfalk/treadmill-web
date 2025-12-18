-- Progressive programs + planned days (separate from existing programs/program_exercises)

CREATE TABLE IF NOT EXISTS progressive_programs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  exercise_key TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('submax', 'ladder')),
  target_value INTEGER,
  test_max INTEGER NOT NULL,
  schedule_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_progressive_programs_user_active
  ON progressive_programs(user_id, active);

CREATE TABLE IF NOT EXISTS progressive_program_days (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  day_type TEXT NOT NULL CHECK (day_type IN ('workout', 'rest', 'test')),
  plan_json TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped')),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES progressive_programs(id) ON DELETE CASCADE,
  UNIQUE (program_id, date)
);

CREATE INDEX IF NOT EXISTS idx_progressive_program_days_program_date
  ON progressive_program_days(program_id, date);

CREATE INDEX IF NOT EXISTS idx_progressive_program_days_date
  ON progressive_program_days(date);

-- Optional: tie a workout log entry to a planned program day.
-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS; this runs once via migrations.
ALTER TABLE workout_sessions ADD COLUMN program_day_id TEXT;

CREATE INDEX IF NOT EXISTS idx_workout_sessions_program_day_id
  ON workout_sessions(program_day_id);
