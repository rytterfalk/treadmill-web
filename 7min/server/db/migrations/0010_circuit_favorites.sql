-- Circuit favorites - shared across all users
CREATE TABLE IF NOT EXISTS circuit_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circuit_program_id INTEGER NOT NULL REFERENCES circuit_programs(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, circuit_program_id)
);

CREATE INDEX IF NOT EXISTS idx_circuit_favorites_program ON circuit_favorites(circuit_program_id);
CREATE INDEX IF NOT EXISTS idx_circuit_favorites_user ON circuit_favorites(user_id);

