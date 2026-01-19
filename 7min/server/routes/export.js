const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../auth');
const { getMET, calculateKcal, getSecPerRep, TRANSITION_SEC } = require('../lib/met-tables');
const { normalizeActivityType, normalizeExerciseTag, detectIntensity } = require('../lib/activity-normalizer');
const { getDuration, parseDistanceFromText } = require('../lib/duration-estimator');

const router = express.Router();

// Constants
const DEFAULT_WEIGHT_KG = 75;
const ESTIMATION_VERSION = 'v1';
const TIME_CORRECTION_THRESHOLD_SEC = 5;

// Helper to get local date string
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalize any date/time input to ISO8601 UTC with Z suffix
 * Handles: "2026-01-12 09:00:56", "2026-01-12T09:00:56.123Z", Date objects
 * @param {string|Date} input - date input
 * @param {string} fallbackDate - YYYY-MM-DD fallback if input is invalid
 * @param {string} fallbackTime - HH:MM:SS fallback time
 * @returns {string} ISO8601 UTC string with Z suffix
 */
function normalizeToUTC(input, fallbackDate = null, fallbackTime = '08:00:00') {
  if (!input) {
    if (fallbackDate) {
      return `${fallbackDate}T${fallbackTime}Z`;
    }
    return new Date().toISOString();
  }

  let date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'string') {
    // Handle "2026-01-12 09:00:56" format (space instead of T)
    const normalized = input.replace(' ', 'T');
    // Add Z if missing and no timezone offset
    const withZ = normalized.match(/[Z+-]\d{2}:?\d{2}$/) ? normalized : `${normalized}Z`;
    date = new Date(withZ);
  } else {
    date = new Date(input);
  }

  // Validate the date
  if (isNaN(date.getTime())) {
    if (fallbackDate) {
      return `${fallbackDate}T${fallbackTime}Z`;
    }
    return new Date().toISOString();
  }

  return date.toISOString();
}

/**
 * Calculate end_time from start_time + duration, with correction flag
 * @param {string} startTimeUTC - start time in UTC ISO8601
 * @param {number} durationSec - duration in seconds
 * @param {string|null} originalEndTime - original end_time from DB (if any)
 * @returns {{ endTime: string, timeCorrected: boolean }}
 */
function calculateEndTime(startTimeUTC, durationSec, originalEndTime = null) {
  const startMs = new Date(startTimeUTC).getTime();
  const calculatedEndMs = startMs + (durationSec * 1000);
  const calculatedEnd = new Date(calculatedEndMs).toISOString();

  if (!originalEndTime) {
    return { endTime: calculatedEnd, timeCorrected: false };
  }

  // Normalize original end time
  const originalEndUTC = normalizeToUTC(originalEndTime);
  const originalEndMs = new Date(originalEndUTC).getTime();

  // Check if difference exceeds threshold
  const diffSec = Math.abs(originalEndMs - calculatedEndMs) / 1000;
  if (diffSec > TIME_CORRECTION_THRESHOLD_SEC) {
    return { endTime: calculatedEnd, timeCorrected: true };
  }

  return { endTime: originalEndUTC, timeCorrected: false };
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

  // Check for running in challenge title first
  const lowerTitle = (title || '').toLowerCase();
  const isRunning = /löp|run|sprint|jogg|km/.test(lowerTitle);

  let activityType;
  if (isRunning) {
    activityType = 'running';
  } else if (exerciseTag) {
    activityType = exerciseTag.includes('plank') || exerciseTag.includes('hang') ? 'isometric' : 'calisthenics';
  } else {
    activityType = normalizeActivityType('other', title);
  }

  const intensity = detectIntensity(title);

  // Duration - for all-day challenges, use calculated duration based on reps, not wall-clock time
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

  // Distance for running challenges
  const distanceResult = parseDistanceFromText(title);
  const distanceM = distanceResult?.distanceM || durationResult.distanceM || null;

  // Normalize start time to UTC
  const startTimeUTC = normalizeToUTC(c.started_at, c.date, '08:00:00');

  // Calculate end time from start + duration (always, to avoid all-day issues)
  const { endTime, timeCorrected } = calculateEndTime(startTimeUTC, durationResult.durationSec, c.ended_at);

  return {
    id: `challenge-${c.id}`,
    date: c.date,
    start_time: startTimeUTC,
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
    distance_m: distanceM,
    source_estimation: durationResult.isEstimated,
    estimation_method: durationResult.method,
    time_corrected: timeCorrected,
    estimation_version: ESTIMATION_VERSION,
    weight_used_kg: weightKg,
    weight_is_default: weightIsDefault,
  };
}

// Enrich a workout session with calculated fields
function enrichWorkout(w, weightKg, weightIsDefault) {
  const title = w.hiit_program_title || w.notes || w.session_type;

  // Check for running keywords in title/notes to ensure correct activity type
  const textToCheck = `${title || ''} ${w.notes || ''}`.toLowerCase();
  const isRunning = /löp|run|sprint|jogg|km|mil/.test(textToCheck);

  // Determine activity type - prioritize running detection
  let activityType;
  if (isRunning) {
    activityType = 'running';
  } else {
    activityType = normalizeActivityType(w.session_type, title);
  }

  const exerciseTag = normalizeExerciseTag(title);
  const intensity = detectIntensity(w.notes || title);

  // Duration
  const durationResult = getDuration({
    duration_sec: w.duration_sec,
    notes: w.notes,
    title: title,
  });

  // Distance (for running/cycling) - check both title and notes
  let distanceResult = parseDistanceFromText(title);
  if (!distanceResult?.distanceM && w.notes) {
    distanceResult = parseDistanceFromText(w.notes);
  }
  const distanceM = distanceResult?.distanceM || durationResult.distanceM || null;

  // MET & Calories
  const met = getMET(activityType, exerciseTag, intensity);
  const kcal = calculateKcal(met, durationResult.durationSec, weightKg);

  // Normalize start time to UTC
  const startTimeUTC = normalizeToUTC(w.started_at || w.created_at, w.date, '08:00:00');

  // Calculate end time from start + duration (always)
  const { endTime, timeCorrected } = calculateEndTime(startTimeUTC, durationResult.durationSec, w.ended_at);

  return {
    id: `workout-${w.id}`,
    date: w.date,
    start_time: startTimeUTC,
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
    distance_m: distanceM,
    source_estimation: durationResult.isEstimated,
    estimation_method: durationResult.method,
    time_corrected: timeCorrected,
    estimation_version: ESTIMATION_VERSION,
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
      estimation_version: ESTIMATION_VERSION,
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
    'Intensitet', 'Estimerad', 'Estimeringsmetod', 'TidKorrigerad', 'Version'
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
    s.kcal_total !== null ? Math.round(s.kcal_total) : '',
    s.kcal_active !== null ? Math.round(s.kcal_active) : '',
    s.intensity,
    s.source_estimation ? 'Ja' : 'Nej',
    s.estimation_method,
    s.time_corrected ? 'Ja' : 'Nej',
    s.estimation_version,
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

