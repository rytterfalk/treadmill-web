-- Allow session_type = 'progressive' in workout_sessions.
-- SQLite cannot ALTER a CHECK constraint; rebuild the table.

CREATE TABLE workout_sessions_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  template_id TEXT,
  session_type TEXT NOT NULL DEFAULT 'other' CHECK (session_type IN ('hiit', 'strength', 'run', 'mobility', 'test', 'other', 'treadmill', 'progressive')),
  started_at TEXT,
  ended_at TEXT,
  duration_sec INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'treadmill', 'ai')),
  treadmill_state_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  program_day_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE SET NULL
);

INSERT INTO workout_sessions_new (
  id,
  user_id,
  template_id,
  session_type,
  started_at,
  ended_at,
  duration_sec,
  notes,
  source,
  treadmill_state_json,
  created_at,
  program_day_id
)
SELECT
  id,
  user_id,
  template_id,
  session_type,
  started_at,
  ended_at,
  duration_sec,
  notes,
  source,
  treadmill_state_json,
  created_at,
  program_day_id
FROM workout_sessions;

DROP TABLE workout_sessions;
ALTER TABLE workout_sessions_new RENAME TO workout_sessions;

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_program_day_id ON workout_sessions(program_day_id);
