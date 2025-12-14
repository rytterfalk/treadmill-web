const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { migrate, db, getUserById } = require('./db');
const {
  authRequired,
  createToken,
  setAuthCookie,
  createUser,
  authenticate,
} = require('./auth');
const { CLIENT_ORIGIN, PORT } = require('./config');

migrate();

const app = express();
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Namn, e-post och lösenord krävs' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Lösenordet måste vara minst 6 tecken' });
  }

  const user = createUser({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
  });

  if (user?.error) {
    return res.status(400).json({ error: user.error });
  }

  const token = createToken(user.id);
  setAuthCookie(res, token);
  res.json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-post och lösenord krävs' });
  }
  const user = authenticate(email, password);
  if (!user) return res.status(401).json({ error: 'Felaktiga uppgifter' });
  const token = createToken(user.id);
  setAuthCookie(res, token);
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

app.get('/api/me', authRequired, (req, res) => {
  const equipment = db
    .prepare(
      `SELECT e.slug, e.name
       FROM equipment e
       JOIN user_equipment ue ON ue.equipment_id = e.id
       WHERE ue.user_id = ?`
    )
    .all(req.user.id);

  res.json({ user: req.user, equipment });
});

app.get('/api/equipment', (req, res) => {
  const items = db.prepare('SELECT slug, name FROM equipment ORDER BY name').all();
  res.json({ equipment: items });
});

app.put('/api/me/equipment', authRequired, (req, res) => {
  const { equipmentSlugs = [] } = req.body;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_equipment WHERE user_id = ?').run(req.user.id);
    const stmt = db.prepare(
      `INSERT INTO user_equipment (user_id, equipment_id)
       SELECT ?, id FROM equipment WHERE slug = ?`
    );
    equipmentSlugs.forEach((slug) => stmt.run(req.user.id, slug));
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/programs', (req, res) => {
  const token = req.cookies.auth_token;
  let userId = null;
  try {
    if (token) {
      const payload = require('jsonwebtoken').verify(token, require('./config').JWT_SECRET);
      userId = payload.userId;
    }
  } catch (err) {
    userId = null;
  }

  const programs = db
    .prepare(
      `SELECT p.id, p.title, p.description, p.rounds, p.is_public, p.created_at,
              p.user_id, u.name AS owner_name
       FROM programs p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.is_public = 1 OR p.user_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(userId);

  res.json({ programs });
});

app.get('/api/programs/:id', (req, res) => {
  const program = db
    .prepare(
      `SELECT p.id, p.user_id, p.title, p.description, p.rounds, p.is_public, p.created_at,
              u.name AS owner_name
       FROM programs p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`
    )
    .get(req.params.id);

  if (!program) return res.status(404).json({ error: 'Programmet finns inte' });

  const exercises = db
    .prepare(
      `SELECT id, position, title, duration_seconds, rest_seconds, notes, equipment_hint
       FROM program_exercises
       WHERE program_id = ?
       ORDER BY position`
    )
    .all(program.id);

  res.json({ program, exercises });
});

app.post('/api/programs', authRequired, (req, res) => {
  const { title, description = '', rounds = 1, exercises = [], isPublic = false } = req.body;
  if (!title || !Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ error: 'Titel och minst en övning krävs' });
  }

  const tx = db.transaction(() => {
    const programId = db
      .prepare(
        'INSERT INTO programs (user_id, title, description, rounds, is_public) VALUES (?, ?, ?, ?, ?)'
      )
      .run(req.user.id, title.trim(), description.trim(), rounds || 1, isPublic ? 1 : 0)
      .lastInsertRowid;

    const insertExercise = db.prepare(
      `INSERT INTO program_exercises
        (program_id, position, title, duration_seconds, rest_seconds, notes, equipment_hint)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    exercises.forEach((exercise, index) => {
      insertExercise.run(
        programId,
        index + 1,
        exercise.title?.trim() || `Moment ${index + 1}`,
        Number(exercise.durationSeconds) || 30,
        Number(exercise.restSeconds) || 0,
        exercise.notes || '',
        exercise.equipmentHint || null
      );
    });

    return programId;
  });

  const programId = tx();
  const program = db
    .prepare('SELECT id, title, description, rounds, is_public, created_at FROM programs WHERE id = ?')
    .get(programId);
  res.status(201).json({ program });
});

app.post('/api/sessions', authRequired, (req, res) => {
  const { programId = null, durationSeconds = null, notes = '', details = null } = req.body;
  const stmt = db.prepare(
    `INSERT INTO sessions (user_id, program_id, duration_seconds, notes, details)
     VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    req.user.id,
    programId,
    durationSeconds,
    notes,
    details ? JSON.stringify(details) : null
  );
  res.status(201).json({ sessionId: result.lastInsertRowid });
});

app.get('/api/sessions/recent', authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.program_id, s.duration_seconds, s.notes, s.details, s.completed_at,
              p.title AS program_title
       FROM sessions s
       LEFT JOIN programs p ON p.id = s.program_id
       WHERE s.user_id = ?
       ORDER BY s.completed_at DESC
       LIMIT 12`
    )
    .all(req.user.id)
    .map((row) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : null,
    }));
  res.json({ sessions: rows });
});

app.listen(PORT, () => {
  console.log(`API kör på http://localhost:${PORT}`);
});
