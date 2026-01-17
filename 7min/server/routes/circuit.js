const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

// Helper to add audio URLs
function withAudioUrls(exercises) {
  return exercises.map((ex) => ({
    ...ex,
    audio_url: ex.audio_filename ? `/uploads/${ex.audio_filename}` : null,
    rest_audio_url: ex.rest_audio_filename ? `/uploads/${ex.rest_audio_filename}` : null,
  }));
}

// Get all circuit programs
router.get('/programs', authRequired, (req, res) => {
  const programs = db
    .prepare(
      `SELECT cp.id, cp.user_id, cp.title, cp.description, cp.rest_seconds, cp.is_public, cp.created_at,
              u.name AS owner_name
       FROM circuit_programs cp
       LEFT JOIN users u ON u.id = cp.user_id
       WHERE cp.user_id = ? OR cp.is_public = 1
       ORDER BY cp.created_at DESC`
    )
    .all(req.user.id);
  res.json({ programs });
});

// Get single circuit program with exercises
router.get('/programs/:id', authRequired, (req, res) => {
  const program = db
    .prepare(
      `SELECT cp.id, cp.user_id, cp.title, cp.description, cp.rest_seconds, cp.is_public, cp.created_at,
              u.name AS owner_name
       FROM circuit_programs cp
       LEFT JOIN users u ON u.id = cp.user_id
       WHERE cp.id = ?`
    )
    .get(req.params.id);

  if (!program) return res.status(404).json({ error: 'Circuit-pass finns inte' });

  const exercises = db
    .prepare(
      `SELECT ce.id, ce.position, ce.title, ce.reps, ce.notes,
              ce.audio_asset_id, ce.rest_audio_asset_id,
              ma.filename AS audio_filename,
              mr.filename AS rest_audio_filename
       FROM circuit_exercises ce
       LEFT JOIN media_assets ma ON ma.id = ce.audio_asset_id
       LEFT JOIN media_assets mr ON mr.id = ce.rest_audio_asset_id
       WHERE ce.circuit_program_id = ?
       ORDER BY ce.position`
    )
    .all(program.id);

  res.json({ program, exercises: withAudioUrls(exercises) });
});

// Create circuit program
router.post('/programs', authRequired, (req, res) => {
  const { title, description = '', restSeconds = 30, exercises = [], isPublic = false } = req.body;
  
  if (!title || !Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ error: 'Titel och minst en övning krävs' });
  }

  const tx = db.transaction(() => {
    const programId = db
      .prepare(
        'INSERT INTO circuit_programs (user_id, title, description, rest_seconds, is_public) VALUES (?, ?, ?, ?, ?)'
      )
      .run(req.user.id, title, description, restSeconds, isPublic ? 1 : 0).lastInsertRowid;

    const insertExercise = db.prepare(
      `INSERT INTO circuit_exercises (circuit_program_id, position, title, reps, notes, audio_asset_id, rest_audio_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    exercises.forEach((ex, idx) => {
      insertExercise.run(
        programId,
        idx + 1,
        ex.title || 'Övning',
        ex.reps || 10,
        ex.notes || '',
        ex.audioAssetId || null,
        ex.restAudioAssetId || null
      );
    });

    return programId;
  });

  const programId = tx();
  const program = db.prepare('SELECT * FROM circuit_programs WHERE id = ?').get(programId);
  const savedExercises = db
    .prepare('SELECT * FROM circuit_exercises WHERE circuit_program_id = ? ORDER BY position')
    .all(programId);

  res.json({ program, exercises: savedExercises });
});

// Update circuit program
router.put('/programs/:id', authRequired, (req, res) => {
  const { title, description, restSeconds } = req.body;
  const program = db.prepare('SELECT * FROM circuit_programs WHERE id = ?').get(req.params.id);
  
  if (!program) return res.status(404).json({ error: 'Circuit-pass finns inte' });
  if (program.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Du kan bara redigera dina egna pass' });
  }

  const updates = [];
  const params = [];

  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: 'Titel får inte vara tom' });
    updates.push('title = ?');
    params.push(title.trim());
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }
  if (restSeconds !== undefined) {
    updates.push('rest_seconds = ?');
    params.push(Number(restSeconds) || 30);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Inget att uppdatera' });
  }

  params.push(req.params.id);
  db.prepare(`UPDATE circuit_programs SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM circuit_programs WHERE id = ?').get(req.params.id);
  res.json({ program: updated });
});

// Delete circuit program
router.delete('/programs/:id', authRequired, (req, res) => {
  const program = db.prepare('SELECT * FROM circuit_programs WHERE id = ?').get(req.params.id);

  if (!program) return res.status(404).json({ error: 'Circuit-pass finns inte' });
  if (program.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Du kan bara ta bort dina egna pass' });
  }

  db.prepare('DELETE FROM circuit_programs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Save circuit session
router.post('/sessions', authRequired, (req, res) => {
  const { circuitProgramId, title, roundsCompleted, totalSeconds, exerciseTimes = [] } = req.body;

  if (!title || roundsCompleted === undefined) {
    return res.status(400).json({ error: 'Titel och antal varv krävs' });
  }

  const sessionId = db
    .prepare(
      `INSERT INTO circuit_sessions (user_id, circuit_program_id, title, rounds_completed, total_seconds, exercise_times)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      circuitProgramId || null,
      title,
      roundsCompleted,
      totalSeconds || 0,
      JSON.stringify(exerciseTimes)
    ).lastInsertRowid;

  const session = db.prepare('SELECT * FROM circuit_sessions WHERE id = ?').get(sessionId);
  res.json({ session });
});

// Get circuit sessions
router.get('/sessions', authRequired, (req, res) => {
  const sessions = db
    .prepare(
      `SELECT cs.*, cp.title AS program_title
       FROM circuit_sessions cs
       LEFT JOIN circuit_programs cp ON cp.id = cs.circuit_program_id
       WHERE cs.user_id = ?
       ORDER BY cs.completed_at DESC
       LIMIT 50`
    )
    .all(req.user.id);

  res.json({
    sessions: sessions.map((s) => ({
      ...s,
      exercise_times: JSON.parse(s.exercise_times || '[]'),
    })),
  });
});

module.exports = { router };

