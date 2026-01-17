-- Circuit programs - rep-based workouts with manual progression
CREATE TABLE IF NOT EXISTS circuit_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  rest_seconds INTEGER NOT NULL DEFAULT 30,
  is_public INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS circuit_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circuit_program_id INTEGER NOT NULL REFERENCES circuit_programs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  reps INTEGER NOT NULL DEFAULT 10,
  notes TEXT DEFAULT '',
  audio_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
  rest_audio_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_circuit_programs_user ON circuit_programs(user_id);
CREATE INDEX IF NOT EXISTS idx_circuit_exercises_program ON circuit_exercises(circuit_program_id);

-- Circuit workout sessions - track completed circuit workouts
CREATE TABLE IF NOT EXISTS circuit_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circuit_program_id INTEGER REFERENCES circuit_programs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  rounds_completed INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  exercise_times TEXT DEFAULT '[]',
  completed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_circuit_sessions_user ON circuit_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_circuit_sessions_date ON circuit_sessions(completed_at);

