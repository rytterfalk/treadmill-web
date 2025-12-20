const express = require('express');
const { authRequired } = require('../auth');
const { db } = require('../db');

const router = express.Router();

const POINTS_CONFIG = {
  capPerDay: 60,
  multipliers: {
    run: 1.0,
    treadmill: 1.0,
    strength: 1.1,
    hiit: 1.4,
    mobility: 0.6,
    test: 0.3,
    progressive: 3.0,
    other: 1.0,
  },
};

const ICONS = {
  run: 'shoe',
  treadmill: 'shoe',
  strength: 'dumbbell',
  hiit: 'bolt',
  test: 'beaker',
  progressive: 'dumbbell',
};

const allowedTypes = new Set(Object.keys(POINTS_CONFIG.multipliers));

function iconForType(type) {
  return ICONS[type] || 'dot';
}

function parseDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKey(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function clampPoints(points) {
  return Math.max(0, Math.round(points));
}

function buildEmptyRange(fromDate, toDate) {
  const days = [];
  const cursor = new Date(fromDate);
  while (cursor <= toDate) {
    days.push({
      date: dateKey(cursor),
      icons: [],
      minutes: 0,
      points: 0,
      sessionIds: [],
      hitCap: false,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function aggregateSessions(sessions) {
  const byDate = new Map();
  sessions.forEach((session) => {
    const day =
      session.day ||
      session.started_at?.slice(0, 10) ||
      session.ended_at?.slice(0, 10) ||
      session.created_at?.slice(0, 10);
    if (!day) return;
    let multiplier = POINTS_CONFIG.multipliers[session.session_type] || 1.0;
    if (session.session_type === 'progressive' && session.program_method === 'submax') {
      multiplier = 4.0;
    }
    const minutes = (Number(session.duration_sec) || 0) / 60;
    const sessionPoints = clampPoints(minutes * multiplier);
    const icon = iconForType(session.session_type);

    if (!byDate.has(day)) {
      byDate.set(day, {
        date: day,
        icons: new Set(),
        minutes: 0,
        points: 0,
        sessionIds: [],
      });
    }
    const bucket = byDate.get(day);
    bucket.minutes += minutes;
    bucket.points += sessionPoints;
    bucket.icons.add(icon);
    bucket.sessionIds.push(session.id);
  });

  return byDate;
}

router.get('/summary', authRequired, (req, res) => {
  const { from, to } = req.query;
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'Ogiltigt datumintervall' });
  }
  if (fromDate > toDate) {
    return res.status(400).json({ error: '"from" måste vara före "to"' });
  }

  const rows = db
    .prepare(
      `SELECT ws.id, ws.user_id, ws.template_id, ws.session_type, ws.started_at, ws.ended_at, ws.duration_sec, ws.notes, ws.source, ws.created_at,
              pp.method AS program_method,
              COALESCE(pd.date, date(COALESCE(ws.started_at, ws.ended_at, ws.created_at))) AS day
       FROM workout_sessions ws
       LEFT JOIN progressive_program_days pd ON pd.id = ws.program_day_id
       LEFT JOIN progressive_programs pp ON pp.id = pd.program_id
       WHERE ws.user_id = ?
         AND date(COALESCE(pd.date, COALESCE(ws.started_at, ws.ended_at, ws.created_at))) BETWEEN date(?) AND date(?)
       ORDER BY ws.started_at ASC`
    )
    .all(req.user.id, from, to);

  const aggregated = aggregateSessions(rows);
  const days = buildEmptyRange(fromDate, toDate).map((entry) => {
    if (!aggregated.has(entry.date)) return entry;
    const bucket = aggregated.get(entry.date);
    const cappedPoints = Math.min(bucket.points, POINTS_CONFIG.capPerDay);
    return {
      date: entry.date,
      icons: Array.from(bucket.icons),
      minutes: Math.round(bucket.minutes),
      points: cappedPoints,
      sessionIds: bucket.sessionIds,
      hitCap: cappedPoints >= POINTS_CONFIG.capPerDay,
    };
  });

  res.json({ days, cap: POINTS_CONFIG.capPerDay });
});

router.get('/weekbars', authRequired, (req, res) => {
  const weeks = Math.max(1, Math.min(12, Number(req.query.weeks) || 8));
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - weeks * 7 + 1);

  const rows = db
    .prepare(
      `SELECT ws.id, ws.session_type, ws.duration_sec, ws.started_at, ws.ended_at, ws.created_at,
              pp.method AS program_method,
              COALESCE(pd.date, date(COALESCE(ws.started_at, ws.ended_at, ws.created_at))) AS day
       FROM workout_sessions ws
       LEFT JOIN progressive_program_days pd ON pd.id = ws.program_day_id
       LEFT JOIN progressive_programs pp ON pp.id = pd.program_id
       WHERE ws.user_id = ?
         AND date(COALESCE(pd.date, COALESCE(ws.started_at, ws.ended_at, ws.created_at))) BETWEEN date(?) AND date(?)
       ORDER BY ws.started_at ASC`
    )
    .all(req.user.id, dateKey(start), dateKey(end));

  const aggregated = aggregateSessions(rows);
  const days = buildEmptyRange(start, end).map((entry) => {
    if (!aggregated.has(entry.date)) return { ...entry, points: 0, hitCap: false };
    const bucket = aggregated.get(entry.date);
    const cappedPoints = Math.min(bucket.points, POINTS_CONFIG.capPerDay);
    return {
      date: entry.date,
      points: cappedPoints,
      hitCap: cappedPoints >= POINTS_CONFIG.capPerDay,
    };
  });

  res.json({ cap: POINTS_CONFIG.capPerDay, days });
});

module.exports = {
  router,
  allowedTypes,
};
