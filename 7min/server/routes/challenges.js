const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

// Auto-continue challenges from previous days
// This is called lazily when fetching challenges
function autoContinueChallenges(userId) {
  const today = new Date().toISOString().slice(0, 10);

  // Find active challenges from previous days (not ended, date < today)
  const oldChallenges = db.prepare(`
    SELECT * FROM daily_challenges
    WHERE user_id = ? AND ended_at IS NULL AND date < ?
  `).all(userId, today);

  if (oldChallenges.length === 0) return;

  const endStmt = db.prepare(`UPDATE daily_challenges SET ended_at = datetime('now') WHERE id = ?`);
  const createStmt = db.prepare(`
    INSERT INTO daily_challenges (user_id, date, exercise, target_reps, interval_minutes)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Use a transaction for atomicity
  const continueAll = db.transaction(() => {
    for (const old of oldChallenges) {
      // End the old challenge
      endStmt.run(old.id);

      // Create a new one for today with the same settings
      createStmt.run(userId, today, old.exercise, old.target_reps, old.interval_minutes);
    }
  });

  continueAll();
}

// Get user's active challenges for today
router.get('/my', authRequired, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  // Auto-continue any challenges from previous days
  autoContinueChallenges(req.user.id);

  const challenges = db.prepare(`
    SELECT dc.*,
           (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
           (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps
    FROM daily_challenges dc
    WHERE dc.user_id = ? AND dc.date = ? AND dc.ended_at IS NULL
    ORDER BY dc.started_at
  `).all(req.user.id, today);

  res.json({ challenges });
});

// Get challenge history for a date range (for Progress view)
router.get('/history', authRequired, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to required' });
  }

  const challenges = db.prepare(`
    SELECT dc.*,
           (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
           (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps
    FROM daily_challenges dc
    WHERE dc.user_id = ? AND dc.date >= ? AND dc.date <= ?
    ORDER BY dc.date DESC, dc.started_at DESC
  `).all(req.user.id, from, to);

  res.json({ challenges });
});

// Get leaderboard for today (all active challenges from all users)
router.get('/leaderboard', authRequired, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const leaderboard = db.prepare(`
    SELECT 
      dc.id,
      dc.user_id,
      u.name as user_name,
      dc.exercise,
      dc.target_reps,
      dc.interval_minutes,
      dc.started_at,
      dc.ended_at,
      (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
      (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
      (SELECT MAX(logged_at) FROM daily_challenge_sets WHERE challenge_id = dc.id) as last_set_at
    FROM daily_challenges dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.date = ?
    ORDER BY total_reps DESC, sets_count DESC
  `).all(today);
  
  res.json({ leaderboard, date: today });
});

// Get recent activity (sets from today, for notifications)
router.get('/activity', authRequired, (req, res) => {
  const { since } = req.query; // ISO timestamp
  const today = new Date().toISOString().slice(0, 10);
  
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
  const { exercise, targetReps = 10, intervalMinutes = 30 } = req.body;
  if (!exercise) {
    return res.status(400).json({ error: 'Övning krävs' });
  }
  
  const today = new Date().toISOString().slice(0, 10);
  
  // Check max 3 active challenges per day
  const activeCount = db.prepare(`
    SELECT COUNT(*) as count FROM daily_challenges 
    WHERE user_id = ? AND date = ? AND ended_at IS NULL
  `).get(req.user.id, today).count;
  
  if (activeCount >= 3) {
    return res.status(400).json({ error: 'Max 3 aktiva utmaningar per dag' });
  }
  
  const stmt = db.prepare(`
    INSERT INTO daily_challenges (user_id, date, exercise, target_reps, interval_minutes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(req.user.id, today, exercise, targetReps, intervalMinutes);
  
  const challenge = db.prepare('SELECT * FROM daily_challenges WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ challenge });
});

// Log a set
router.post('/:id/sets', authRequired, (req, res) => {
  const { id } = req.params;
  const { reps, retroactive = false } = req.body;
  
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
    INSERT INTO daily_challenge_sets (challenge_id, reps, retroactive)
    VALUES (?, ?, ?)
  `);
  stmt.run(id, reps, retroactive ? 1 : 0);
  
  // Return updated stats
  const stats = db.prepare(`
    SELECT COUNT(*) as sets_count, COALESCE(SUM(reps), 0) as total_reps
    FROM daily_challenge_sets WHERE challenge_id = ?
  `).get(id);
  
  res.json({ 
    challenge_id: Number(id), 
    sets_count: stats.sets_count, 
    total_reps: stats.total_reps 
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
    SELECT COUNT(*) as sets_count, COALESCE(SUM(reps), 0) as total_reps
    FROM daily_challenge_sets WHERE challenge_id = ?
  `).get(id);
  
  res.json({ challenge: updated, ...stats });
});

module.exports = { router };

