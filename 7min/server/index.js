const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFile } = require('child_process');
const { migrate, db, getUserById } = require('./db');
const { router: calendarRouter, allowedTypes: calendarAllowedTypes } = require('./routes/calendar');
const { router: progressiveRouter } = require('./routes/progressive');
const { router: challengesRouter } = require('./routes/challenges');
const { router: adminRouter } = require('./routes/admin');
const { router: circuitRouter } = require('./routes/circuit');
const { router: exportRouter } = require('./routes/export');
const { regenerateSummary } = require('./lib/summary');
const {
  authRequired,
  createToken,
  setAuthCookie,
  createUser,
  authenticate,
} = require('./auth');
const { CLIENT_ORIGIN, PORT, UPLOAD_DIR } = require('./config');

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
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));

function toAssetResponse(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    type: asset.type,
    mime: asset.mime,
    size: asset.size,
    url: `/uploads/${asset.filename}`,
  };
}

function withExerciseMedia(rows) {
  return rows.map((row) => ({
    ...row,
    audio_asset_id: row.audio_asset_id || null,
    audio_url: row.audio_filename ? `/uploads/${row.audio_filename}` : null,
    half_audio_asset_id: row.half_audio_asset_id || null,
    half_audio_url: row.half_audio_filename ? `/uploads/${row.half_audio_filename}` : null,
    image_asset_id: row.image_asset_id || null,
    image_url: row.image_filename ? `/uploads/${row.image_filename}` : null,
  }));
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8);
    const id = crypto.randomUUID();
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/', 'image/'];
    if (allowed.some((prefix) => file.mimetype.startsWith(prefix))) {
      cb(null, true);
    } else {
      cb(new Error('Ogiltig filtyp'));
    }
  },
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Convert audio file to MP3 using ffmpeg (for Safari/iOS compatibility)
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', inputPath,
      '-y',                    // Overwrite output
      '-vn',                   // No video
      '-ar', '44100',          // Sample rate
      '-ac', '1',              // Mono (smaller file)
      '-b:a', '128k',          // Bitrate
      '-f', 'mp3',             // Output format
      outputPath
    ], (error, stdout, stderr) => {
      if (error) {
        console.error('ffmpeg error:', stderr);
        reject(error);
      } else {
        resolve(outputPath);
      }
    });
  });
}

app.post('/api/media', authRequired, upload.single('file'), async (req, res) => {
  const { type = 'audio' } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Fil saknas' });
  if (!['audio', 'image'].includes(type)) {
    return res.status(400).json({ error: 'Ogiltig typ' });
  }

  let finalFilename = file.filename;
  let finalMime = file.mimetype;
  let finalSize = file.size;

  // Convert audio files to MP3 for cross-browser compatibility
  if (type === 'audio' && !file.mimetype.includes('mp3')) {
    try {
      const inputPath = path.join(UPLOAD_DIR, file.filename);
      const mp3Filename = file.filename.replace(/\.[^.]+$/, '.mp3');
      const outputPath = path.join(UPLOAD_DIR, mp3Filename);

      await convertToMp3(inputPath, outputPath);

      // Delete original file
      fs.unlinkSync(inputPath);

      // Update file info
      finalFilename = mp3Filename;
      finalMime = 'audio/mpeg';
      finalSize = fs.statSync(outputPath).size;

      console.log(`Converted ${file.filename} -> ${mp3Filename}`);
    } catch (err) {
      console.error('Audio conversion failed:', err);
      // Continue with original file if conversion fails
    }
  }

  const asset = db
    .prepare(
      `INSERT INTO media_assets (user_id, type, mime, filename, size)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.user.id, type, finalMime, finalFilename, finalSize);

  res.status(201).json({
    asset: {
      id: asset.lastInsertRowid,
      type,
      mime: finalMime,
      size: finalSize,
      url: `/uploads/${finalFilename}`,
    },
  });
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

// Update user profile (weight, height, etc.)
app.put('/api/me/profile', authRequired, (req, res) => {
  const { weight_kg, height_cm, birth_year, sex } = req.body;

  // Validate
  if (weight_kg !== undefined && (typeof weight_kg !== 'number' || weight_kg < 20 || weight_kg > 300)) {
    return res.status(400).json({ error: 'Vikt måste vara mellan 20-300 kg' });
  }
  if (height_cm !== undefined && (typeof height_cm !== 'number' || height_cm < 100 || height_cm > 250)) {
    return res.status(400).json({ error: 'Längd måste vara mellan 100-250 cm' });
  }
  if (birth_year !== undefined && (typeof birth_year !== 'number' || birth_year < 1900 || birth_year > new Date().getFullYear())) {
    return res.status(400).json({ error: 'Ogiltigt födelseår' });
  }
  if (sex !== undefined && !['male', 'female', 'other', null].includes(sex)) {
    return res.status(400).json({ error: 'Ogiltigt kön' });
  }

  db.prepare(`
    UPDATE users
    SET weight_kg = COALESCE(?, weight_kg),
        height_cm = COALESCE(?, height_cm),
        birth_year = COALESCE(?, birth_year),
        sex = COALESCE(?, sex)
    WHERE id = ?
  `).run(weight_kg, height_cm, birth_year, sex, req.user.id);

  const updatedUser = getUserById(req.user.id);
  res.json({ user: updatedUser });
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
      `SELECT pe.id, pe.position, pe.title, pe.duration_seconds, pe.rest_seconds, pe.notes, pe.equipment_hint,
              pe.audio_asset_id, pe.half_audio_asset_id, pe.image_asset_id,
              ma.filename AS audio_filename, ma.mime AS audio_mime,
              mh.filename AS half_audio_filename, mh.mime AS half_audio_mime,
              mi.filename AS image_filename, mi.mime AS image_mime
       FROM program_exercises
       pe
       LEFT JOIN media_assets ma ON ma.id = pe.audio_asset_id
       LEFT JOIN media_assets mh ON mh.id = pe.half_audio_asset_id
       LEFT JOIN media_assets mi ON mi.id = pe.image_asset_id
       WHERE pe.program_id = ?
       ORDER BY pe.position`
    )
    .all(program.id);

  res.json({ program, exercises: withExerciseMedia(exercises) });
});

// Get all favorites (shared across users)
app.get('/api/favorites', authRequired, (req, res) => {
  const favorites = db
    .prepare(
      `SELECT pf.program_id, pf.user_id, pf.created_at, u.name AS user_name
       FROM program_favorites pf
       JOIN users u ON u.id = pf.user_id
       ORDER BY pf.created_at DESC`
    )
    .all();
  res.json({ favorites });
});

// Add a favorite
app.post('/api/favorites/:programId', authRequired, (req, res) => {
  const programId = Number(req.params.programId);
  const program = db.prepare('SELECT id FROM programs WHERE id = ?').get(programId);
  if (!program) return res.status(404).json({ error: 'Programmet finns inte' });

  try {
    db.prepare('INSERT INTO program_favorites (user_id, program_id) VALUES (?, ?)').run(
      req.user.id,
      programId
    );
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.json({ ok: true, alreadyExists: true });
    }
    throw err;
  }
  res.json({ ok: true });
});

// Remove a favorite
app.delete('/api/favorites/:programId', authRequired, (req, res) => {
  const programId = Number(req.params.programId);
  db.prepare('DELETE FROM program_favorites WHERE user_id = ? AND program_id = ?').run(
    req.user.id,
    programId
  );
  res.json({ ok: true });
});

app.delete('/api/programs/:id', authRequired, (req, res) => {
  const program = db
    .prepare('SELECT id, user_id, is_public FROM programs WHERE id = ?')
    .get(req.params.id);
  if (!program) return res.status(404).json({ error: 'Programmet finns inte' });
  const isOwner = program.user_id && program.user_id === req.user.id;
  const isUnowned = program.user_id === null;
  const isPublic = !!program.is_public;
  // Tillåt ta bort egna pass, samt oägda pass som inte är publika (gamla lokala kopior).
  if (!isOwner && !(isUnowned && !isPublic)) {
    return res.status(403).json({ error: 'Du kan bara ta bort dina egna (eller oägda) pass' });
  }
  db.prepare('DELETE FROM programs WHERE id = ?').run(program.id);
  res.json({ ok: true, deletedId: program.id });
});

// Update program metadata (title, description, rounds)
app.put('/api/programs/:id', authRequired, (req, res) => {
  const { title, description, rounds } = req.body;
  const program = db
    .prepare('SELECT id, user_id, is_public FROM programs WHERE id = ?')
    .get(req.params.id);

  if (!program) return res.status(404).json({ error: 'Programmet finns inte' });

  const isOwner = program.user_id && program.user_id === req.user.id;
  if (!isOwner) {
    return res.status(403).json({ error: 'Du kan bara redigera dina egna pass' });
  }

  const updates = [];
  const params = [];

  if (title !== undefined) {
    if (!title.trim()) {
      return res.status(400).json({ error: 'Titel får inte vara tom' });
    }
    updates.push('title = ?');
    params.push(title.trim());
  }

  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description.trim());
  }

  if (rounds !== undefined) {
    updates.push('rounds = ?');
    params.push(Number(rounds) || 1);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Inget att uppdatera' });
  }

  params.push(req.params.id);
  db.prepare(`UPDATE programs SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db
    .prepare(
      `SELECT p.id, p.user_id, p.title, p.description, p.rounds, p.is_public, p.created_at,
              u.name AS owner_name
       FROM programs p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`
    )
    .get(req.params.id);

  res.json({ program: updated });
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
        (program_id, position, title, duration_seconds, rest_seconds, notes, equipment_hint, audio_asset_id, half_audio_asset_id, image_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    exercises.forEach((exercise, index) => {
      const audioAssetId = exercise.audioAssetId || null;
      const halfAudioAssetId = exercise.halfAudioAssetId || null;
      const imageAssetId = exercise.imageAssetId || null;
      if (audioAssetId) {
        const asset = db
          .prepare('SELECT id FROM media_assets WHERE id = ? AND user_id = ?')
          .get(audioAssetId, req.user.id);
        if (!asset) throw new Error('Ogiltigt ljud-id');
      }
      if (halfAudioAssetId) {
        const asset = db
          .prepare('SELECT id FROM media_assets WHERE id = ? AND user_id = ?')
          .get(halfAudioAssetId, req.user.id);
        if (!asset) throw new Error('Ogiltigt halvtidsljud-id');
      }
      if (imageAssetId) {
        const asset = db
          .prepare('SELECT id FROM media_assets WHERE id = ? AND user_id = ?')
          .get(imageAssetId, req.user.id);
        if (!asset) throw new Error('Ogiltigt bild-id');
      }

      insertExercise.run(
        programId,
        index + 1,
        exercise.title?.trim() || `Moment ${index + 1}`,
        Number(exercise.durationSeconds) || 30,
        Number(exercise.restSeconds) || 0,
        exercise.notes || '',
        exercise.equipmentHint || null,
        audioAssetId,
        halfAudioAssetId,
        imageAssetId
      );
    });

    return programId;
  });

  let programId;
  try {
    programId = tx();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Kunde inte spara programmet' });
  }

  const program = db
    .prepare('SELECT id, title, description, rounds, is_public, created_at FROM programs WHERE id = ?')
    .get(programId);
  const exercisesSaved = db
    .prepare(
      `SELECT pe.id, pe.position, pe.title, pe.duration_seconds, pe.rest_seconds, pe.notes, pe.equipment_hint,
              pe.audio_asset_id, pe.half_audio_asset_id, pe.image_asset_id,
              ma.filename AS audio_filename, ma.mime AS audio_mime,
              mh.filename AS half_audio_filename, mh.mime AS half_audio_mime,
              mi.filename AS image_filename, mi.mime AS image_mime
       FROM program_exercises pe
       LEFT JOIN media_assets ma ON ma.id = pe.audio_asset_id
       LEFT JOIN media_assets mh ON mh.id = pe.half_audio_asset_id
       LEFT JOIN media_assets mi ON mi.id = pe.image_asset_id
       WHERE pe.program_id = ?
       ORDER BY pe.position`
    )
    .all(programId);

  res.status(201).json({ program, exercises: withExerciseMedia(exercisesSaved) });
});

app.post('/api/sessions', authRequired, (req, res) => {
  const {
    programId = null,
    durationSeconds = null,
    notes = '',
    details = null,
    sessionType = 'other',
    startedAt = null,
    programTitle = null,
  } = req.body;
  const stmt = db.prepare(
    `INSERT INTO sessions (user_id, program_id, duration_seconds, notes, details)
     VALUES (?, ?, ?, ?, ?)`
  );
  const inserted = stmt.run(
    req.user.id,
    programId,
    durationSeconds,
    notes,
    details ? JSON.stringify(details) : null
  );
  const type = calendarAllowedTypes.has(sessionType) ? sessionType : 'other';
  const parsedDuration = durationSeconds !== null ? Number(durationSeconds) : null;
  const durationSec = Number.isNaN(parsedDuration) ? null : parsedDuration;
  const startDate = startedAt ? new Date(startedAt) : new Date();
  const startIso = Number.isNaN(startDate.getTime())
    ? new Date().toISOString()
    : startDate.toISOString();
  const endIso =
    durationSec !== null && !Number.isNaN(durationSec)
      ? new Date(new Date(startIso).getTime() + durationSec * 1000).toISOString()
      : startIso;

  const workoutId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO workout_sessions
      (id, user_id, template_id, session_type, started_at, ended_at, duration_sec, notes, source, treadmill_state_json, hiit_program_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?)`
  ).run(workoutId, req.user.id, null, type, startIso, endIso, durationSec, notes || '', programTitle || null);

  regenerateSummary(); // Update Lena's training summary

  res.status(201).json({ sessionId: inserted.lastInsertRowid, workoutSessionId: workoutId });
});

// Log a run session
app.post('/api/workout-sessions/run', authRequired, (req, res) => {
  const {
    distance_km,
    duration_sec,
    notes = '',
    started_at = null,
    run_type = 'outdoor',      // outdoor, treadmill, track
    workout_type = 'easy',     // easy, zone2, intervals, tempo, long, race
  } = req.body;

  if (!distance_km || distance_km <= 0) {
    return res.status(400).json({ error: 'Distans krävs' });
  }
  if (!duration_sec || duration_sec <= 0) {
    return res.status(400).json({ error: 'Tid krävs' });
  }

  const distanceNum = Number(distance_km);
  const durationNum = Math.round(Number(duration_sec));

  // Calculate pace (min/km)
  const paceMinPerKm = durationNum / 60 / distanceNum;
  const paceMin = Math.floor(paceMinPerKm);
  const paceSec = Math.round((paceMinPerKm - paceMin) * 60);
  const paceStr = `${paceMin}:${String(paceSec).padStart(2, '0')}`;

  // Build descriptive title based on run/workout type
  const runTypeLabels = { outdoor: 'Utomhus', treadmill: 'Löpband', track: 'Bana' };
  const workoutTypeLabels = {
    easy: 'Lugnt',
    zone2: 'Zone 2',
    intervals: 'Intervaller',
    tempo: 'Tempo',
    long: 'Långpass',
    race: 'Tävling',
  };
  const runLabel = runTypeLabels[run_type] || 'Utomhus';
  const workoutLabel = workoutTypeLabels[workout_type] || '';
  const autoTitle = workoutLabel
    ? `${workoutLabel} ${distanceNum}km (${runLabel})`
    : `Löpning ${distanceNum}km (${runLabel})`;

  const runJson = {
    distance_km: distanceNum,
    pace_min_per_km: paceStr,
    run_type,
    workout_type,
  };

  const endDate = started_at ? new Date(started_at) : new Date();
  const endIso = Number.isNaN(endDate.getTime()) ? new Date().toISOString() : endDate.toISOString();
  const startIso = new Date(new Date(endIso).getTime() - durationNum * 1000).toISOString();

  const workoutId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO workout_sessions
      (id, user_id, session_type, started_at, ended_at, duration_sec, notes, source, treadmill_state_json)
     VALUES (?, ?, 'run', ?, ?, ?, ?, 'manual', ?)`
  ).run(workoutId, req.user.id, startIso, endIso, durationNum, notes || autoTitle, JSON.stringify(runJson));

  regenerateSummary(); // Update Lena's training summary

  res.status(201).json({
    workoutSessionId: workoutId,
    distance_km: distanceNum,
    duration_sec: durationNum,
    pace: paceStr,
    run_type,
    workout_type,
  });
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

app.get('/api/sessions', authRequired, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date krävs (YYYY-MM-DD)' });
  // Use 'localtime' modifier to convert UTC timestamps to local timezone for date matching
  const rows = db
    .prepare(
      `SELECT id, user_id, template_id, session_type, started_at, ended_at, duration_sec, notes, source, treadmill_state_json, created_at
       FROM workout_sessions
       WHERE user_id = ? AND date(COALESCE(started_at, ended_at, created_at), 'localtime') = date(?)
       ORDER BY started_at DESC`
    )
    .all(req.user.id, date);

  res.json({ sessions: rows });
});

app.get('/api/sessions/:id', authRequired, (req, res) => {
  const session = db
    .prepare(
      `SELECT id, user_id, template_id, session_type, started_at, ended_at, duration_sec, notes, source, treadmill_state_json, created_at
       FROM workout_sessions
       WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Sessionen finns inte' });
  res.json({ session });
});

app.get('/api/workout-sessions/recent', authRequired, (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 1));
  // Use 'localtime' modifier to convert UTC timestamps to local timezone for date grouping
  const rows = db
    .prepare(
      `SELECT ws.id, ws.user_id, ws.template_id, ws.session_type, ws.started_at, ws.ended_at, ws.duration_sec,
              ws.notes, ws.source, ws.treadmill_state_json, ws.program_day_id, ws.created_at,
              pd.date AS program_day_date, pd.result_json AS program_day_result_json, pd.plan_json AS program_day_plan_json,
              pd.day_type AS program_day_type,
              pp.exercise_key AS program_exercise_key, pp.method AS program_method,
              COALESCE(pd.date, date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime')) AS day
       FROM workout_sessions ws
       LEFT JOIN progressive_program_days pd ON pd.id = ws.program_day_id
       LEFT JOIN progressive_programs pp ON pp.id = pd.program_id
       WHERE ws.user_id = ?
       ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
       LIMIT ?`
    )
    .all(req.user.id, limit);
  res.json({
    workouts: rows.map((row) => ({
      ...row,
      program_day_result_json: row.program_day_result_json ? JSON.parse(row.program_day_result_json) : null,
      program_day_plan_json: row.program_day_plan_json ? JSON.parse(row.program_day_plan_json) : null,
    })),
  });
});

app.get('/api/workout-sessions', authRequired, (req, res) => {
  const { date, from, to } = req.query || {};
  const limitRaw = req.query?.limit;
  const limit = limitRaw != null ? Math.max(1, Math.min(200, Number(limitRaw) || 50)) : 200;

  // Use 'localtime' modifier to convert UTC timestamps to local timezone for date matching
  if (typeof date === 'string' && date) {
    const rows = db
      .prepare(
        `SELECT ws.id, ws.user_id, ws.template_id, ws.session_type, ws.started_at, ws.ended_at, ws.duration_sec,
                ws.notes, ws.source, ws.treadmill_state_json, ws.program_day_id, ws.created_at,
                pd.date AS program_day_date, pd.result_json AS program_day_result_json, pd.plan_json AS program_day_plan_json,
                pd.day_type AS program_day_type,
                pp.exercise_key AS program_exercise_key, pp.method AS program_method,
                COALESCE(pd.date, date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime')) AS day
         FROM workout_sessions ws
         LEFT JOIN progressive_program_days pd ON pd.id = ws.program_day_id
         LEFT JOIN progressive_programs pp ON pp.id = pd.program_id
         WHERE ws.user_id = ?
           AND date(COALESCE(pd.date, COALESCE(ws.started_at, ws.ended_at, ws.created_at)), 'localtime') = date(?)
         ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
         LIMIT ?`
      )
      .all(req.user.id, date, limit);

    return res.json({
      workouts: rows.map((row) => ({
        ...row,
        program_day_result_json: row.program_day_result_json ? JSON.parse(row.program_day_result_json) : null,
        program_day_plan_json: row.program_day_plan_json ? JSON.parse(row.program_day_plan_json) : null,
      })),
    });
  }

  if (typeof from === 'string' && from && typeof to === 'string' && to) {
    const rows = db
      .prepare(
        `SELECT ws.id, ws.user_id, ws.template_id, ws.session_type, ws.started_at, ws.ended_at, ws.duration_sec,
                ws.notes, ws.source, ws.treadmill_state_json, ws.program_day_id, ws.created_at,
                pd.date AS program_day_date, pd.result_json AS program_day_result_json, pd.plan_json AS program_day_plan_json,
                pd.day_type AS program_day_type,
                pp.exercise_key AS program_exercise_key, pp.method AS program_method,
                COALESCE(pd.date, date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime')) AS day
         FROM workout_sessions ws
         LEFT JOIN progressive_program_days pd ON pd.id = ws.program_day_id
         LEFT JOIN progressive_programs pp ON pp.id = pd.program_id
         WHERE ws.user_id = ?
           AND date(COALESCE(pd.date, COALESCE(ws.started_at, ws.ended_at, ws.created_at)), 'localtime') BETWEEN date(?) AND date(?)
         ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
         LIMIT ?`
      )
      .all(req.user.id, from, to, limit);

    return res.json({
      workouts: rows.map((row) => ({
        ...row,
        program_day_result_json: row.program_day_result_json ? JSON.parse(row.program_day_result_json) : null,
        program_day_plan_json: row.program_day_plan_json ? JSON.parse(row.program_day_plan_json) : null,
      })),
    });
  }

  return res.status(400).json({ error: 'date eller from+to krävs' });
});

app.get('/api/workout-sessions/:id', authRequired, (req, res) => {
  // Use 'localtime' modifier to convert UTC timestamps to local timezone for date grouping
  const row = db
    .prepare(
      `SELECT ws.id, ws.user_id, ws.template_id, ws.session_type, ws.started_at, ws.ended_at, ws.duration_sec,
              ws.notes, ws.source, ws.treadmill_state_json, ws.program_day_id, ws.created_at,
              date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') AS day,
              pd.date AS program_day_date, pd.result_json AS program_day_result_json, pd.plan_json AS program_day_plan_json,
              pd.day_type AS program_day_type,
              pp.exercise_key AS program_exercise_key, pp.method AS program_method
       FROM workout_sessions ws
       LEFT JOIN progressive_program_days pd ON pd.id = ws.program_day_id
       LEFT JOIN progressive_programs pp ON pp.id = pd.program_id
       WHERE ws.id = ? AND ws.user_id = ?`
    )
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Sessionen finns inte' });
  res.json({
    workout: {
      ...row,
      program_day_result_json: row.program_day_result_json ? JSON.parse(row.program_day_result_json) : null,
      program_day_plan_json: row.program_day_plan_json ? JSON.parse(row.program_day_plan_json) : null,
    },
  });
});

app.use('/api/calendar', calendarRouter);
app.use('/api', progressiveRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/circuit', circuitRouter);
app.use('/api/export', exportRouter);

// Ensure API errors are returned as JSON (not HTML), so the client can show the real message.
// Must be registered after routes.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode || 500);
  const message = err.message || 'Internal Server Error';
  if (req.path && req.path.startsWith('/api')) {
    return res.status(status).json({ error: message });
  }
  return res.status(status).send('Server error');
});

// Fallback för SPA - servera index.html för alla andra GET:ar som inte är /api
app.get(/^(?!\/api).*/, (req, res) => {
  return res.sendFile(path.join(distPath, 'index.html'));
});

if (process.env.HTTPS_KEY && process.env.HTTPS_CERT) {
  const key = fs.readFileSync(process.env.HTTPS_KEY);
  const cert = fs.readFileSync(process.env.HTTPS_CERT);
  https.createServer({ key, cert }, app).listen(PORT, () => {
    console.log(`API kör (HTTPS) på https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`API kör på http://localhost:${PORT}`);
  });
}
