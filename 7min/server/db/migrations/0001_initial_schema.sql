-- Initial schema: auth/program builder + Milestone 1 workout model

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('audio', 'image')),
  mime TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_equipment (
  user_id INTEGER NOT NULL,
  equipment_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, equipment_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  rounds INTEGER DEFAULT 1,
  is_public INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS program_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  rest_seconds INTEGER DEFAULT 0,
  notes TEXT,
  equipment_hint TEXT,
  audio_asset_id INTEGER,
  half_audio_asset_id INTEGER,
  image_asset_id INTEGER,
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  FOREIGN KEY (audio_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (half_audio_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (image_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  program_id INTEGER,
  duration_seconds INTEGER,
  notes TEXT,
  details TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_program_exercises_program_id ON program_exercises(program_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Milestone 1: templates/sessions/routines/tests/imports
CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'public')),
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('hiit', 'strength', 'run', 'mobility', 'test', 'other')),
  estimated_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_blocks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('interval', 'exercise', 'rest', 'note')),
  payload_json TEXT,
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  template_id TEXT,
  session_type TEXT NOT NULL DEFAULT 'other' CHECK (session_type IN ('hiit', 'strength', 'run', 'mobility', 'test', 'other', 'treadmill')),
  started_at TEXT,
  ended_at TEXT,
  duration_sec INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'treadmill', 'ai')),
  treadmill_state_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_rule_json TEXT NOT NULL,
  next_due_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routine_completions (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  session_id TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS fitness_tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  description TEXT,
  category TEXT,
  scoring_json TEXT
);

CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  test_id TEXT NOT NULL,
  value_num REAL,
  value_text TEXT,
  performed_at TEXT NOT NULL,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES fitness_tests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  meta_json TEXT,
  error_text TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_template_blocks_template_id ON template_blocks(template_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_entries_session_id ON session_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id, active);
CREATE INDEX IF NOT EXISTS idx_routine_completions_routine_id ON routine_completions(routine_id);
CREATE INDEX IF NOT EXISTS idx_test_results_user_id ON test_results(user_id, test_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_imports_user_id ON imports(user_id, created_at);
