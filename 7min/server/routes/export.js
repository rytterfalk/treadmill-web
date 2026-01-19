const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

// Helper to format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Helper to get local date string
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get all workout data for a date range
function getWorkoutData(userId, from, to) {
  // Get challenges with sets
  const challenges = db.prepare(`
    SELECT 
      dc.id, dc.date, dc.exercise, dc.target_reps, dc.interval_minutes,
      dc.is_timed, dc.target_seconds, dc.started_at, dc.ended_at,
      (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count,
      (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
      (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds
    FROM daily_challenges dc
    WHERE dc.user_id = ? AND dc.date >= ? AND dc.date <= ?
    ORDER BY dc.date, dc.started_at
  `).all(userId, from, to);

  // Get workout sessions
  const workouts = db.prepare(`
    SELECT 
      ws.id, ws.session_type, ws.started_at, ws.ended_at, ws.duration_sec,
      ws.notes, ws.source, ws.hiit_program_title,
      date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') as date
    FROM workout_sessions ws
    WHERE ws.user_id = ?
      AND date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') >= ?
      AND date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') <= ?
    ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at)
  `).all(userId, from, to);

  return { challenges, workouts };
}

// Generate TCX XML for strength/other workouts
function generateTCX(data, from, to) {
  const { challenges, workouts } = data;
  
  let activities = '';
  
  // Group challenges by date and create one activity per day
  const challengesByDate = {};
  for (const c of challenges) {
    if (!challengesByDate[c.date]) challengesByDate[c.date] = [];
    challengesByDate[c.date].push(c);
  }
  
  for (const [date, daysChallenges] of Object.entries(challengesByDate)) {
    const totalReps = daysChallenges.reduce((sum, c) => sum + (c.total_reps || 0), 0);
    const totalSets = daysChallenges.reduce((sum, c) => sum + (c.sets_count || 0), 0);
    const totalSeconds = daysChallenges.reduce((sum, c) => sum + (c.total_seconds || 0), 0);
    
    // Estimate duration: 30 seconds per set for reps-based, actual seconds for timed
    const estimatedDuration = daysChallenges.reduce((sum, c) => {
      if (c.is_timed) return sum + (c.total_seconds || 0);
      return sum + (c.sets_count || 0) * 30;
    }, 0);
    
    const exercises = daysChallenges.map(c => {
      if (c.is_timed) return `${c.exercise}: ${Math.round(c.total_seconds / 60)} min`;
      return `${c.exercise}: ${c.total_reps} reps (${c.sets_count} set)`;
    }).join(', ');
    
    const startTime = `${date}T08:00:00.000Z`;
    
    activities += `
    <Activity Sport="Other">
      <Id>${startTime}</Id>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${estimatedDuration}</TotalTimeSeconds>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Notes>${exercises}</Notes>
      </Lap>
      <Notes>Styrketräning: ${exercises}</Notes>
    </Activity>`;
  }
  
  // Add workout sessions
  for (const w of workouts) {
    const startTime = w.started_at || `${w.date}T08:00:00.000Z`;
    const duration = w.duration_sec || 0;
    const title = w.hiit_program_title || w.session_type || 'Workout';
    
    activities += `
    <Activity Sport="Other">
      <Id>${startTime}</Id>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${duration}</TotalTimeSeconds>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
      </Lap>
      <Notes>${title}${w.notes ? ': ' + w.notes : ''}</Notes>
    </Activity>`;
  }
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>${activities}
  </Activities>
</TrainingCenterDatabase>`;
}

// Generate CSV
function generateCSV(data, from, to) {
  const { challenges, workouts } = data;
  
  let csv = 'Datum,Typ,Övning,Reps,Set,Tid (sek),Anteckningar\n';
  
  for (const c of challenges) {
    const typ = c.is_timed ? 'Tidad utmaning' : 'Utmaning';
    csv += `${c.date},${typ},${c.exercise},${c.total_reps || 0},${c.sets_count || 0},${c.total_seconds || 0},\n`;
  }
  
  for (const w of workouts) {
    const title = w.hiit_program_title || w.session_type;
    csv += `${w.date},${w.session_type},${title},,,${w.duration_sec || 0},"${(w.notes || '').replace(/"/g, '""')}"\n`;
  }
  
  return csv;
}

// Export endpoint
router.get('/:format', authRequired, (req, res) => {
  const { format } = req.params;
  let { from, to } = req.query;
  
  // Default to last 7 days
  if (!to) to = getLocalDateString();
  if (!from) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    from = getLocalDateString(d);
  }
  
  const data = getWorkoutData(req.user.id, from, to);
  
  if (format === 'tcx') {
    const tcx = generateTCX(data, from, to);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="workout-${from}-${to}.tcx"`);
    return res.send(tcx);
  }
  
  if (format === 'csv') {
    const csv = generateCSV(data, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="workout-${from}-${to}.csv"`);
    return res.send('\ufeff' + csv); // BOM for Excel
  }
  
  res.status(400).json({ error: 'Format stöds inte. Använd tcx eller csv.' });
});

module.exports = { router };

