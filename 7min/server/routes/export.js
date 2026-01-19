const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../auth');
const { getMET, calculateKcal, getSecPerRep, TRANSITION_SEC } = require('../lib/met-tables');
const { normalizeActivityType, normalizeExerciseTag, detectIntensity } = require('../lib/activity-normalizer');
const { getDuration, parseDistanceFromText } = require('../lib/duration-estimator');

const router = express.Router();

// Default weight if user hasn't set one
const DEFAULT_WEIGHT_KG = 75;

// Helper to get local date string
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get user weight (with fallback)
function getUserWeight(userId) {
  const user = db.prepare('SELECT weight_kg FROM users WHERE id = ?').get(userId);
  return {
    weightKg: user?.weight_kg || DEFAULT_WEIGHT_KG,
    isDefault: !user?.weight_kg,
  };
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
      ws.notes, ws.source, ws.hiit_program_title, ws.created_at,
      date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') as date
    FROM workout_sessions ws
    WHERE ws.user_id = ?
      AND date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') >= ?
      AND date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') <= ?
    ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at)
  `).all(userId, from, to);

  return { challenges, workouts };
}

// Enrich a challenge with calculated fields
function enrichChallenge(c, weightKg, weightIsDefault) {
  const title = c.exercise;
  const exerciseTag = normalizeExerciseTag(title);
  const activityType = exerciseTag ?
    (exerciseTag.includes('plank') || exerciseTag.includes('hang') ? 'isometric' : 'calisthenics') :
    normalizeActivityType('other', title);
  const intensity = detectIntensity(title);

  // Duration
  const durationResult = getDuration({
    is_timed: c.is_timed,
    total_seconds: c.total_seconds,
    total_reps: c.total_reps,
    sets_count: c.sets_count,
    exercise: c.exercise,
  });

  // MET & Calories
  const met = getMET(activityType, exerciseTag, intensity);
  const kcal = calculateKcal(met, durationResult.durationSec, weightKg);

  // Start/End times
  const startTime = c.started_at || `${c.date}T08:00:00.000Z`;
  const endTime = c.ended_at || new Date(new Date(startTime).getTime() + durationResult.durationSec * 1000).toISOString();

  return {
    id: `challenge-${c.id}`,
    date: c.date,
    start_time: startTime,
    end_time: endTime,
    duration_sec: durationResult.durationSec,
    activity_type: activityType,
    exercise_tag: exerciseTag,
    intensity,
    title: c.exercise,
    reps: c.total_reps || 0,
    sets: c.sets_count || 0,
    met_value: met,
    kcal_total: weightIsDefault ? null : kcal.kcalTotal,
    kcal_active: weightIsDefault ? null : kcal.kcalActive,
    distance_m: null,
    source_estimation: durationResult.isEstimated,
    estimation_method: durationResult.method,
    weight_used_kg: weightKg,
    weight_is_default: weightIsDefault,
  };
}

// Enrich a workout session with calculated fields
function enrichWorkout(w, weightKg, weightIsDefault) {
  const title = w.hiit_program_title || w.notes || w.session_type;
  const activityType = normalizeActivityType(w.session_type, title);
  const exerciseTag = normalizeExerciseTag(title);
  const intensity = detectIntensity(w.notes || title);

  // Duration
  const durationResult = getDuration({
    duration_sec: w.duration_sec,
    notes: w.notes,
    title: title,
  });

  // Distance (for running/cycling)
  const distanceResult = parseDistanceFromText(w.notes || title);

  // MET & Calories
  const met = getMET(activityType, exerciseTag, intensity);
  const kcal = calculateKcal(met, durationResult.durationSec, weightKg);

  // Start/End times
  const startTime = w.started_at || w.created_at || `${w.date}T08:00:00.000Z`;
  const endTime = w.ended_at || new Date(new Date(startTime).getTime() + durationResult.durationSec * 1000).toISOString();

  return {
    id: `workout-${w.id}`,
    date: w.date,
    start_time: startTime,
    end_time: endTime,
    duration_sec: durationResult.durationSec,
    activity_type: activityType,
    exercise_tag: exerciseTag,
    intensity,
    title: title || w.session_type,
    reps: null,
    sets: null,
    met_value: met,
    kcal_total: weightIsDefault ? null : kcal.kcalTotal,
    kcal_active: weightIsDefault ? null : kcal.kcalActive,
    distance_m: distanceResult?.distanceM || durationResult.distanceM || null,
    source_estimation: durationResult.isEstimated,
    estimation_method: durationResult.method,
    weight_used_kg: weightKg,
    weight_is_default: weightIsDefault,
  };
}

// Get enriched data for export
function getEnrichedData(userId, from, to) {
  const { weightKg, isDefault: weightIsDefault } = getUserWeight(userId);
  const { challenges, workouts } = getWorkoutData(userId, from, to);

  const enrichedChallenges = challenges.map(c => enrichChallenge(c, weightKg, weightIsDefault));
  const enrichedWorkouts = workouts.map(w => enrichWorkout(w, weightKg, weightIsDefault));

  return {
    sessions: [...enrichedChallenges, ...enrichedWorkouts].sort((a, b) =>
      new Date(a.start_time) - new Date(b.start_time)
    ),
    meta: {
      from,
      to,
      weight_kg: weightKg,
      weight_is_default: weightIsDefault,
      exported_at: new Date().toISOString(),
    },
  };
}

// Generate TCX XML from enriched data
function generateTCX(enrichedData) {
  const { sessions, meta } = enrichedData;

  let activities = '';

  for (const s of sessions) {
    const calories = s.kcal_active ? Math.round(s.kcal_active) : 0;
    const sport = s.activity_type === 'running' ? 'Running' :
                  s.activity_type === 'hiit' ? 'Other' : 'Other';

    // Escape XML special chars
    const notes = (s.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    activities += `
    <Activity Sport="${sport}">
      <Id>${s.start_time}</Id>
      <Lap StartTime="${s.start_time}">
        <TotalTimeSeconds>${s.duration_sec}</TotalTimeSeconds>
        <DistanceMeters>${s.distance_m || 0}</DistanceMeters>
        <Calories>${calories}</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
      </Lap>
      <Notes>${notes}${s.reps ? ` (${s.reps} reps, ${s.sets} set)` : ''}</Notes>
    </Activity>`;
  }
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>${activities}
  </Activities>
</TrainingCenterDatabase>`;
}

// Generate enriched CSV
function generateCSV(enrichedData) {
  const { sessions, meta } = enrichedData;

  const headers = [
    'Datum', 'Starttid', 'Sluttid', 'Duration (sek)', 'Aktivitetstyp', 'Övning/Titel',
    'Reps', 'Set', 'Distans (m)', 'MET', 'kcal Total', 'kcal Aktiv',
    'Intensitet', 'Estimerad', 'Estimeringsmetod'
  ].join(',');

  const rows = sessions.map(s => [
    s.date,
    s.start_time,
    s.end_time,
    s.duration_sec,
    s.activity_type,
    `"${(s.title || '').replace(/"/g, '""')}"`,
    s.reps || '',
    s.sets || '',
    s.distance_m || '',
    s.met_value,
    s.kcal_total || '',
    s.kcal_active || '',
    s.intensity,
    s.source_estimation ? 'Ja' : 'Nej',
    s.estimation_method,
  ].join(','));

  return [headers, ...rows].join('\n');
}

// Generate JSON export
function generateJSON(enrichedData) {
  return JSON.stringify(enrichedData, null, 2);
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

  const enrichedData = getEnrichedData(req.user.id, from, to);

  if (format === 'tcx') {
    const tcx = generateTCX(enrichedData);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="workout-${from}-${to}.tcx"`);
    return res.send(tcx);
  }

  if (format === 'csv') {
    const csv = generateCSV(enrichedData);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="workout-${from}-${to}.csv"`);
    return res.send('\ufeff' + csv); // BOM for Excel
  }

  if (format === 'json') {
    const json = generateJSON(enrichedData);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="workout-${from}-${to}.json"`);
    return res.send(json);
  }

  res.status(400).json({ error: 'Format stöds inte. Använd tcx, csv eller json.' });
});

module.exports = { router };

