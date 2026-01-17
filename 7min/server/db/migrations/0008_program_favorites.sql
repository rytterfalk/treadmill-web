-- Program favorites - shared across all users
CREATE TABLE IF NOT EXISTS program_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_program_favorites_program ON program_favorites(program_id);
CREATE INDEX IF NOT EXISTS idx_program_favorites_user ON program_favorites(user_id);

