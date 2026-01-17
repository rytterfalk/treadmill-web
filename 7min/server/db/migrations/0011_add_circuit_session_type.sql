-- Add 'circuit' to workout_sessions session_type
-- SQLite doesn't support ALTER TABLE to modify CHECK constraints,
-- so we need to recreate the table

-- Create new table with updated constraint
CREATE TABLE IF NOT EXISTS workout_sessions_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  template_id TEXT,
  session_type TEXT NOT NULL DEFAULT 'other' CHECK (session_type IN ('hiit', 'strength', 'run', 'mobility', 'test', 'other', 'treadmill', 'progressive', 'circuit')),
  started_at TEXT,
  ended_at TEXT,
  duration_sec INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'treadmill', 'ai')),
  treadmill_state_json TEXT,
  program_day_id INTEGER,
  hiit_program_title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (program_day_id) REFERENCES progressive_program_days(id) ON DELETE SET NULL
);

-- Copy data from old table
INSERT INTO workout_sessions_new 
SELECT id, user_id, template_id, session_type, started_at, ended_at, duration_sec, notes, source, treadmill_state_json, program_day_id, hiit_program_title, created_at
FROM workout_sessions;

-- Drop old table
DROP TABLE workout_sessions;

-- Rename new table
ALTER TABLE workout_sessions_new RENAME TO workout_sessions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_date ON workout_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_program_day ON workout_sessions(program_day_id);

