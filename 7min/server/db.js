const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now')),
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
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      program_id INTEGER,
      duration_seconds INTEGER,
      notes TEXT,
      details TEXT,
      completed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL
    );
  `);

  const equipmentSeeds = [
    ['bodyweight', 'Kroppsvikt'],
    ['pull-up-bar', 'Pull-up stång'],
    ['dumbbells', 'Hantlar'],
    ['kettlebell', 'Kettlebell'],
    ['yoga-mat', 'Yogamatta'],
    ['bench', 'Bänk'],
  ];
  const insertEquipment = db.prepare(
    'INSERT OR IGNORE INTO equipment (slug, name) VALUES (?, ?)'
  );
  equipmentSeeds.forEach(([slug, name]) => insertEquipment.run(slug, name));

  const programCount = db.prepare('SELECT COUNT(*) as count FROM programs').get()
    .count;
  if (programCount === 0) {
    const insertProgram = db.prepare(
      'INSERT INTO programs (user_id, title, description, rounds, is_public) VALUES (NULL, ?, ?, ?, 1)'
    );
    const programId = insertProgram.run(
      '7-Minutersklassikern',
      'Klassisk 7-minuters workout med 12 övningar.',
      2
    ).lastInsertRowid;

    const exercises = [
      'Jumping Jacks',
      'Wall Sit',
      'Push-ups',
      'Sit-ups',
      'Step-ups',
      'Squats',
      'Triceps Dips',
      'Plankan',
      'Höga knän',
      'Utfall',
      'Armhävningar med rotation',
      'Sidoplanka (höger & vänster)',
    ];

    const insertExercise = db.prepare(
      `INSERT INTO program_exercises
        (program_id, position, title, duration_seconds, rest_seconds, notes)
        VALUES (?, ?, ?, ?, ?, ?)`
    );
    exercises.forEach((title, index) => {
      insertExercise.run(programId, index + 1, title, 30, 10, 'Tempo: medelhög');
    });
  }
}

function getUserById(id) {
  return db
    .prepare('SELECT id, name, email, created_at FROM users WHERE id = ?')
    .get(id);
}

module.exports = {
  db,
  migrate,
  getUserById,
};
