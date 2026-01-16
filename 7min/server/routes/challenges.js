const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

// Helper to get local date as YYYY-MM-DD string
// This respects the server's timezone (which should match the user's timezone)
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Auto-continue challenges from previous days
// This is called lazily when fetching challenges
// The old challenge is ended and a new one is created for today (starting at 0 reps)
// Sets stay on their original challenge so history is preserved correctly
function autoContinueChallenges(userId) {
  const today = getLocalDateString();

  // Find active challenges from previous days (not ended, date < today)
  const oldChallenges = db.prepare(`
    SELECT * FROM daily_challenges
    WHERE user_id = ? AND ended_at IS NULL AND date < ?
  `).all(userId, today);

  if (oldChallenges.length === 0) return;

  const endStmt = db.prepare(`UPDATE daily_challenges SET ended_at = datetime('now') WHERE id = ?`);
  const createStmt = db.prepare(`
    INSERT INTO daily_challenges (user_id, date, exercise, target_reps, interval_minutes, is_timed, target_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Use a transaction for atomicity
  const continueAll = db.transaction(() => {
    for (const old of oldChallenges) {
      // End the old challenge (preserving its sets for history)
      endStmt.run(old.id);

      // Create a new one for today with the same settings (starts at 0 reps/seconds)
      createStmt.run(userId, today, old.exercise, old.target_reps, old.interval_minutes, old.is_timed, old.target_seconds);
    }
  });

  continueAll();
}

// Get user's active challenges for today
router.get('/my', authRequired, (req, res) => {
  const today = getLocalDateString();

  // Auto-continue any challenges from previous days
  autoContinueChallenges(req.user.id);

  const challenges = db.prepare(`
    SELECT dc.*,
           (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
           (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
           (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds,
           (SELECT MAX(logged_at) FROM daily_challenge_sets WHERE challenge_id = dc.id) as last_set_at
    FROM daily_challenges dc
    WHERE dc.user_id = ? AND dc.date = ? AND dc.ended_at IS NULL
    ORDER BY dc.started_at
  `).all(req.user.id, today);

  res.json({ challenges });
});

// Get challenge history for a date range (for Progress view)
// If from/to not provided, defaults to last 7 days
router.get('/history', authRequired, (req, res) => {
  let { from, to } = req.query;

  // Default to last 7 days if not provided
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(getLocalDateString(d));
  }

  if (!from) from = dates[dates.length - 1]; // oldest date
  if (!to) to = dates[0]; // today

  // Get all challenges with sets for the date range
  const challenges = db.prepare(`
    SELECT
      dc.id,
      dc.user_id,
      dc.date,
      u.name as user_name,
      dc.exercise,
      dc.target_reps,
      dc.interval_minutes,
      dc.is_timed,
      dc.target_seconds,
      (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
      (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
      (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds
    FROM daily_challenges dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.date >= ? AND dc.date <= ?
    ORDER BY dc.date DESC, total_reps DESC, total_seconds DESC
  `).all(from, to);

  // Get all workout sessions for the date range (HIIT, strength, etc)
  // Use 'localtime' modifier to convert UTC timestamps to local timezone
  const workouts = db.prepare(`
    SELECT
      ws.id,
      ws.user_id,
      u.name as user_name,
      ws.session_type,
      ws.duration_sec,
      ws.notes,
      ws.started_at,
      ws.ended_at,
      ws.hiit_program_title,
      wt.title as template_title,
      date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') as date
    FROM workout_sessions ws
    JOIN users u ON u.id = ws.user_id
    LEFT JOIN workout_templates wt ON wt.id = ws.template_id
    WHERE date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') >= ?
      AND date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') <= ?
    ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
  `).all(from, to);

  res.json({ dates, challenges, workouts });
});

// Get leaderboard for today (all active challenges from all users)
router.get('/leaderboard', authRequired, (req, res) => {
  const today = getLocalDateString();
  const leaderboard = db.prepare(`
    SELECT
      dc.id,
      dc.user_id,
      u.name as user_name,
      dc.exercise,
      dc.target_reps,
      dc.interval_minutes,
      dc.is_timed,
      dc.target_seconds,
      dc.started_at,
      dc.ended_at,
      (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
      (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
      (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds,
      (SELECT MAX(logged_at) FROM daily_challenge_sets WHERE challenge_id = dc.id) as last_set_at
    FROM daily_challenges dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.date = ?
    ORDER BY total_reps DESC, total_seconds DESC, sets_count DESC
  `).all(today);

  res.json({ leaderboard, date: today });
});

// Get recent activity (sets from today, for notifications)
router.get('/activity', authRequired, (req, res) => {
  const { since } = req.query; // ISO timestamp
  const today = getLocalDateString();
  
  let query = `
    SELECT 
      dcs.id,
      dcs.reps,
      dcs.logged_at,
      dc.exercise,
      dc.user_id,
      u.name as user_name
    FROM daily_challenge_sets dcs
    JOIN daily_challenges dc ON dc.id = dcs.challenge_id
    JOIN users u ON u.id = dc.user_id
    WHERE dc.date = ? AND dc.user_id != ?
  `;
  const params = [today, req.user.id];
  
  if (since) {
    query += ` AND dcs.logged_at > ?`;
    params.push(since);
  }
  
  query += ` ORDER BY dcs.logged_at DESC LIMIT 20`;
  
  const activity = db.prepare(query).all(...params);
  res.json({ activity });
});

// Create a new challenge
router.post('/', authRequired, (req, res) => {
  const { exercise, targetReps = 10, intervalMinutes = 30, isTimed = false, targetSeconds = null } = req.body;
  if (!exercise) {
    return res.status(400).json({ error: 'Övning krävs' });
  }

  const today = getLocalDateString();

  // Check max 3 active challenges per day
  const activeCount = db.prepare(`
    SELECT COUNT(*) as count FROM daily_challenges
    WHERE user_id = ? AND date = ? AND ended_at IS NULL
  `).get(req.user.id, today).count;

  if (activeCount >= 3) {
    return res.status(400).json({ error: 'Max 3 aktiva utmaningar per dag' });
  }

  const stmt = db.prepare(`
    INSERT INTO daily_challenges (user_id, date, exercise, target_reps, interval_minutes, is_timed, target_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(req.user.id, today, exercise, isTimed ? 0 : targetReps, intervalMinutes, isTimed ? 1 : 0, isTimed ? targetSeconds : null);

  const challenge = db.prepare('SELECT * FROM daily_challenges WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ challenge });
});

// Log a set
router.post('/:id/sets', authRequired, (req, res) => {
  const { id } = req.params;
  const { reps, seconds, retroactive = false } = req.body;

  // Verify ownership
  const challenge = db.prepare(`
    SELECT * FROM daily_challenges WHERE id = ? AND user_id = ?
  `).get(id, req.user.id);

  if (!challenge) {
    return res.status(404).json({ error: 'Utmaning finns inte' });
  }

  if (challenge.ended_at) {
    return res.status(400).json({ error: 'Utmaningen är avslutad' });
  }

  const stmt = db.prepare(`
    INSERT INTO daily_challenge_sets (challenge_id, reps, seconds, retroactive)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, challenge.is_timed ? 0 : (reps || 0), challenge.is_timed ? (seconds || 0) : null, retroactive ? 1 : 0);

  // Return updated stats
  const stats = db.prepare(`
    SELECT COUNT(*) as sets_count, COALESCE(SUM(reps), 0) as total_reps, COALESCE(SUM(seconds), 0) as total_seconds
    FROM daily_challenge_sets WHERE challenge_id = ?
  `).get(id);

  res.json({
    challenge_id: Number(id),
    sets_count: stats.sets_count,
    total_reps: stats.total_reps,
    total_seconds: stats.total_seconds
  });
});

// Get all sets for a challenge
router.get('/:id/sets', authRequired, (req, res) => {
  const { id } = req.params;

  // Verify ownership
  const challenge = db.prepare(`
    SELECT * FROM daily_challenges WHERE id = ? AND user_id = ?
  `).get(id, req.user.id);

  if (!challenge) {
    return res.status(404).json({ error: 'Utmaning finns inte' });
  }

  const sets = db.prepare(`
    SELECT id, reps, seconds, retroactive, logged_at
    FROM daily_challenge_sets
    WHERE challenge_id = ?
    ORDER BY logged_at ASC
  `).all(id);

  res.json({ sets, is_timed: challenge.is_timed });
});

// Delete a specific set
router.post('/:id/sets/:setId/delete', authRequired, (req, res) => {
  const { id, setId } = req.params;

  // Verify challenge ownership
  const challenge = db.prepare(`
    SELECT * FROM daily_challenges WHERE id = ? AND user_id = ?
  `).get(id, req.user.id);

  if (!challenge) {
    return res.status(404).json({ error: 'Utmaning finns inte' });
  }

  // Verify set belongs to this challenge
  const set = db.prepare(`
    SELECT * FROM daily_challenge_sets WHERE id = ? AND challenge_id = ?
  `).get(setId, id);

  if (!set) {
    return res.status(404).json({ error: 'Set finns inte' });
  }

  db.prepare('DELETE FROM daily_challenge_sets WHERE id = ?').run(setId);

  // Return updated stats
  const stats = db.prepare(`
    SELECT COUNT(*) as sets_count, COALESCE(SUM(reps), 0) as total_reps, COALESCE(SUM(seconds), 0) as total_seconds
    FROM daily_challenge_sets WHERE challenge_id = ?
  `).get(id);

  res.json({
    deleted: true,
    sets_count: stats.sets_count,
    total_reps: stats.total_reps,
    total_seconds: stats.total_seconds
  });
});

// End a challenge
router.post('/:id/end', authRequired, (req, res) => {
  const { id } = req.params;

  const challenge = db.prepare(`
    SELECT * FROM daily_challenges WHERE id = ? AND user_id = ?
  `).get(id, req.user.id);

  if (!challenge) {
    return res.status(404).json({ error: 'Utmaning finns inte' });
  }

  db.prepare(`UPDATE daily_challenges SET ended_at = datetime('now') WHERE id = ?`).run(id);

  const updated = db.prepare('SELECT * FROM daily_challenges WHERE id = ?').get(id);
  const stats = db.prepare(`
    SELECT COUNT(*) as sets_count, COALESCE(SUM(reps), 0) as total_reps, COALESCE(SUM(seconds), 0) as total_seconds
    FROM daily_challenge_sets WHERE challenge_id = ?
  `).get(id);

  res.json({ challenge: updated, ...stats });
});

module.exports = { router };

