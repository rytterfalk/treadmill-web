const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');
const { runMigrations } = require('./db/migrate');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

function ensureProgramExerciseColumns() {
  const programExerciseColumns = db.prepare('PRAGMA table_info(program_exercises)').all();
  const columnNames = new Set(programExerciseColumns.map((c) => c.name));
  const pending = [
    ['audio_asset_id', 'INTEGER'],
    ['half_audio_asset_id', 'INTEGER'],
    ['image_asset_id', 'INTEGER'],
  ];

  pending.forEach(([name, type]) => {
    if (!columnNames.has(name)) {
      db.exec(`ALTER TABLE program_exercises ADD COLUMN ${name} ${type}`);
    }
  });
}

function seedEquipment() {
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
}

function seedDefaultProgram() {
  const programCount = db.prepare('SELECT COUNT(*) as count FROM programs').get().count;
  if (programCount !== 0) return;

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

function migrate() {
  const appliedMigrations = runMigrations(db);
  ensureProgramExerciseColumns();
  seedEquipment();
  seedDefaultProgram();
  return appliedMigrations;
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
