const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../config');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function runMigrations(db) {
  ensureMigrationsTable(db);

  const applied = new Set(
    db
      .prepare('SELECT id FROM migrations')
      .all()
      .map((row) => row.id)
  );

  const files = listMigrationFiles();
  const appliedNow = [];

  files.forEach((file) => {
    const id = path.basename(file, '.sql');
    if (applied.has(id)) return;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, datetime(\'now\'))').run(id);
    });
    tx();
    appliedNow.push(id);
  });

  return appliedNow;
}

function cli() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const applied = runMigrations(db);
  if (applied.length === 0) {
    console.log('No new migrations to apply.');
  } else {
    applied.forEach((id) => console.log(`Applied migration ${id}`));
  }
}

if (require.main === module) {
  cli();
}

module.exports = {
  runMigrations,
  MIGRATIONS_DIR,
};
