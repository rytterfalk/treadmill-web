const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

const ALLOWED_METHODS = new Set(['submax', 'ladder']);
const ALLOWED_EXERCISES = new Set(['burpees', 'pushups', 'pullups']);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoDateUTC(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function dayNameUTC(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return DAY_NAMES[date.getUTCDay()];
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return Math.max(min, Math.min(max, i));
}

function clampRestSec(value) {
  return clampInt(value, 15, 600);
}

function createSubmaxPlan(exerciseKey, workReps, restSec) {
  const reps = clampInt(workReps, 1, 1000) || 1;
  const rest = clampRestSec(restSec) || 150;
  return {
    method: 'submax',
    exercise_key: exerciseKey,
    sets: Array.from({ length: 5 }, () => ({ target_reps: reps, rest_sec: rest })),
    notes: 'Submax volym. Stoppa 1–2 reps innan failure.',
  };
}

function createLadderPlan(exerciseKey, top) {
  const t = clampInt(top, 3, 20) || 3;
  const steps = Array.from({ length: t }, (_, i) => i + 1);
  return {
    method: 'ladder',
    exercise_key: exerciseKey,
    ladders: [
      {
        steps,
        rest_between_steps_sec: 60,
        rest_between_ladders_sec: 120,
      },
    ],
    notes: 'Ladder. Ingen failure. Bra form.',
  };
}

function createTestPlan(exerciseKey) {
  return {
    method: 'test',
    exercise_key: exerciseKey,
    notes: 'Gör ett max-test (så många reps du kan med bra form) och spara resultatet.',
  };
}

function initialStateFromTestMax({ method, exerciseKey, testMax }) {
  const max = clampInt(testMax, 1, 1000) || 1;
  if (method === 'submax') {
    const workReps = Math.max(1, Math.round(max * 0.7));
    return {
      method,
      exercise_key: exerciseKey,
      test_max: max,
      work_reps: workReps,
      rest_sec: 150,
      drop_streak: 0,
      version: 2,
    };
  }
  const top = Math.max(3, Math.min(12, Math.round(max * 0.6)));
  return { method, exercise_key: exerciseKey, test_max: max, top, version: 1 };
}

function planForWorkout(state) {
  if (!state || !state.method || !state.exercise_key) return null;
  if (state.method === 'submax') {
    return createSubmaxPlan(state.exercise_key, state.work_reps, state.rest_sec);
  }
  if (state.method === 'ladder') return createLadderPlan(state.exercise_key, state.top);
  return null;
}

function generateProgramDays({
  programId,
  exerciseKey,
  preferredDays,
  testEveryWeeks = 4,
  state,
  startDate = new Date(),
}) {
  const start = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  );
  const totalDays = 28;
  const testIndex = Math.max(0, Math.min(totalDays - 1, testEveryWeeks * 7 - 1));

  const days = [];
  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = isoDateUTC(d);

    let dayType = 'rest';
    if (i === testIndex) {
      dayType = 'test';
    } else {
      const name = dayNameUTC(date);
      if (preferredDays.includes(name)) dayType = 'workout';
    }

    let planJson = null;
    if (dayType === 'workout') planJson = planForWorkout(state);
    if (dayType === 'test') planJson = createTestPlan(exerciseKey);

    days.push({
      id: crypto.randomUUID(),
      program_id: programId,
      date,
      day_type: dayType,
      plan_json: planJson ? JSON.stringify(planJson) : null,
      status: 'planned',
      result_json: null,
    });
  }

  return days;
}

function generateProgramDaysFromIsoDate({
  programId,
  exerciseKey,
  preferredDays,
  testEveryWeeks = 4,
  state,
  startIsoDate, // YYYY-MM-DD
}) {
  const startDate = new Date(`${startIsoDate}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Ogiltigt startdatum');
  }
  return generateProgramDays({
    programId,
    exerciseKey,
    preferredDays,
    testEveryWeeks,
    state,
    startDate,
  });
}

function insertProgramDays(days) {
  const insertDay = db.prepare(
    `INSERT OR IGNORE INTO progressive_program_days
      (id, program_id, date, day_type, plan_json, status, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  days.forEach((d) => {
    insertDay.run(
      d.id,
      d.program_id,
      d.date,
      d.day_type,
      d.plan_json,
      d.status,
      d.result_json
    );
  });
}

function normalizeProgramRow(row) {
  if (!row) return null;
  return {
    ...row,
    schedule: safeJsonParse(row.schedule_json),
    state: safeJsonParse(row.state_json),
    schedule_json: undefined,
    state_json: undefined,
  };
}

function normalizeProgramDayRow(row) {
  if (!row) return null;
  return {
    ...row,
    plan: safeJsonParse(row.plan_json),
    result: safeJsonParse(row.result_json),
    plan_json: undefined,
    result_json: undefined,
  };
}

router.post('/progressive-programs', authRequired, (req, res) => {
  const {
    exercise_key: exerciseKeyRaw,
    method: methodRaw,
    test_max: testMaxRaw,
    days_per_week: daysPerWeekRaw,
    preferred_days: preferredDaysRaw,
  } = req.body || {};

  const exerciseKey = String(exerciseKeyRaw || '').trim().toLowerCase();
  const method = String(methodRaw || '').trim().toLowerCase();
  const testMax = clampInt(testMaxRaw, 1, 1000);
  const daysPerWeek = clampInt(daysPerWeekRaw, 3, 4);
  const preferredDays = Array.isArray(preferredDaysRaw)
    ? preferredDaysRaw.map((d) => String(d).trim()).filter(Boolean)
    : [];

  if (!ALLOWED_EXERCISES.has(exerciseKey)) {
    return res.status(400).json({ error: 'Ogiltig övning (exercise_key)' });
  }
  if (!ALLOWED_METHODS.has(method)) {
    return res.status(400).json({ error: 'Ogiltig metod (method)' });
  }
  if (!testMax) {
    return res.status(400).json({ error: 'test_max måste vara ett heltal >= 1' });
  }
  if (!daysPerWeek || ![3, 4].includes(daysPerWeek)) {
    return res.status(400).json({ error: 'days_per_week måste vara 3 eller 4' });
  }
  if (preferredDays.length !== daysPerWeek) {
    return res
      .status(400)
      .json({ error: 'preferred_days måste innehålla exakt days_per_week dagar' });
  }
  const preferredUnique = new Set(preferredDays);
  if (preferredUnique.size !== preferredDays.length) {
    return res.status(400).json({ error: 'preferred_days får inte innehålla dubbletter' });
  }
  if (preferredDays.some((d) => !DAY_NAMES.includes(d))) {
    return res.status(400).json({ error: 'preferred_days måste vara Mon/Tue/Wed/Thu/Fri/Sat/Sun' });
  }

  const schedule = { days_per_week: daysPerWeek, preferred_days: preferredDays, test_every_weeks: 4 };
  const state = initialStateFromTestMax({ method, exerciseKey, testMax });
  const programId = crypto.randomUUID();
  const days = generateProgramDays({
    programId,
    exerciseKey,
    preferredDays,
    testEveryWeeks: schedule.test_every_weeks,
    state,
  });

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO progressive_programs
        (id, user_id, exercise_key, method, target_value, test_max, schedule_json, state_json, active)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1)`
    ).run(
      programId,
      req.user.id,
      exerciseKey,
      method,
      testMax,
      JSON.stringify(schedule),
      JSON.stringify(state)
    );

    insertProgramDays(days);
  });

  try {
    tx();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Kunde inte skapa program' });
  }

  const program = db
    .prepare(
      `SELECT id, user_id, exercise_key, method, target_value, test_max, schedule_json, state_json, active, created_at
       FROM progressive_programs
       WHERE id = ? AND user_id = ?`
    )
    .get(programId, req.user.id);

  res.status(201).json({ program: normalizeProgramRow(program), days_created: days.length });
});

router.get('/progressive-programs', authRequired, (req, res) => {
  const programs = db
    .prepare(
      `SELECT id, user_id, exercise_key, method, target_value, test_max, schedule_json, state_json, active, created_at
       FROM progressive_programs
       WHERE user_id = ?
       ORDER BY active DESC, created_at DESC`
    )
    .all(req.user.id)
    .map(normalizeProgramRow);

  res.json({ programs });
});

router.get('/progressive-programs/:id', authRequired, (req, res) => {
  const program = db
    .prepare(
      `SELECT id, user_id, exercise_key, method, target_value, test_max, schedule_json, state_json, active, created_at
       FROM progressive_programs
       WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, req.user.id);

  if (!program) return res.status(404).json({ error: 'Programmet finns inte' });

  const today = isoDateUTC(new Date());
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to =
    typeof req.query.to === 'string'
      ? req.query.to
      : (() => {
          const d = new Date(`${today}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() + 27);
          return isoDateUTC(d);
        })();

  const days = db
    .prepare(
      `SELECT id, program_id, date, day_type, plan_json, status, result_json, created_at
       FROM progressive_program_days
       WHERE program_id = ?
         AND date(date) BETWEEN date(?) AND date(?)
       ORDER BY date ASC`
    )
    .all(program.id, from, to)
    .map(normalizeProgramDayRow);

  res.json({ program: normalizeProgramRow(program), days });
});

router.post('/progressive-programs/:id/deactivate', authRequired, (req, res) => {
  const program = db
    .prepare('SELECT id, active FROM progressive_programs WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!program) return res.status(404).json({ error: 'Programmet finns inte' });

  db.prepare('UPDATE progressive_programs SET active = 0 WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.user.id
  );
  res.json({ ok: true, id: req.params.id });
});

router.get('/today', authRequired, (req, res) => {
  const today = isoDateUTC(new Date());

  const row = db
    .prepare(
      `SELECT d.id AS day_id, d.program_id, d.date, d.day_type, d.plan_json, d.status, d.result_json, d.created_at AS day_created_at,
              (SELECT ws.duration_sec
               FROM workout_sessions ws
               WHERE ws.program_day_id = d.id
               ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
               LIMIT 1) AS workout_duration_sec,
              (SELECT ws.started_at
               FROM workout_sessions ws
               WHERE ws.program_day_id = d.id
               ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
               LIMIT 1) AS workout_started_at,
              (SELECT ws.ended_at
               FROM workout_sessions ws
               WHERE ws.program_day_id = d.id
               ORDER BY COALESCE(ws.started_at, ws.ended_at, ws.created_at) DESC
               LIMIT 1) AS workout_ended_at,
              p.id AS program_id2, p.exercise_key, p.method, p.target_value, p.test_max, p.schedule_json, p.state_json, p.active, p.created_at AS program_created_at
       FROM progressive_program_days d
       JOIN progressive_programs p ON p.id = d.program_id
       WHERE p.user_id = ?
         AND p.active = 1
         AND date(d.date) = date(?)
       ORDER BY
         CASE d.day_type WHEN 'test' THEN 0 WHEN 'workout' THEN 1 ELSE 2 END,
         p.created_at DESC
       LIMIT 1`
    )
    .get(req.user.id, today);

  if (!row) return res.json({ kind: 'none' });

  const program = normalizeProgramRow({
    id: row.program_id2,
    user_id: req.user.id,
    exercise_key: row.exercise_key,
    method: row.method,
    target_value: row.target_value,
    test_max: row.test_max,
    schedule_json: row.schedule_json,
    state_json: row.state_json,
    active: row.active,
    created_at: row.program_created_at,
  });

  const programDay = normalizeProgramDayRow({
    id: row.day_id,
    program_id: row.program_id,
    date: row.date,
    day_type: row.day_type,
    plan_json: row.plan_json,
    status: row.status,
    result_json: row.result_json,
    workout_duration_sec: row.workout_duration_sec,
    workout_started_at: row.workout_started_at,
    workout_ended_at: row.workout_ended_at,
    created_at: row.day_created_at,
  });

  res.json({ kind: 'program_day', program_day: programDay, program });
});

router.post('/program-days/:id/skip', authRequired, (req, res) => {
  const day = db
    .prepare(
      `SELECT d.id, d.program_id, d.date, d.day_type, d.status,
              p.user_id
       FROM progressive_program_days d
       JOIN progressive_programs p ON p.id = d.program_id
       WHERE d.id = ? AND p.user_id = ?`
    )
    .get(req.params.id, req.user.id);

  if (!day) return res.status(404).json({ error: 'Programdagen finns inte' });
  if (day.status !== 'planned') {
    return res.status(400).json({ error: 'Programdagen är redan hanterad' });
  }

  db.prepare(
    `UPDATE progressive_program_days
     SET status = 'skipped'
     WHERE id = ?`
  ).run(req.params.id);

  res.json({ ok: true, id: req.params.id });
});

function sumInt(values) {
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

function analyzeSubmaxSession({ plan, result }) {
  const targets = Array.isArray(plan?.sets)
    ? plan.sets.map((s) => clampInt(s?.target_reps, 0, 1000) || 0)
    : [];
  const actuals = Array.isArray(result?.sets)
    ? result.sets.map((s) => clampInt(s?.actual_reps, 0, 1000) || 0)
    : [];

  const setCount = Math.min(targets.length, actuals.length);
  const t = targets.slice(0, setCount);
  const a = actuals.slice(0, setCount);

  const totalTarget = sumInt(t);
  const totalActual = sumInt(a);
  const ratio = totalTarget > 0 ? totalActual / totalTarget : null;

  const misses = [];
  for (let i = 0; i < setCount; i += 1) {
    if ((a[i] || 0) < (t[i] || 0)) misses.push(i);
  }
  const missesCount = misses.length;
  const firstMissIndex = missesCount ? misses[0] : null;
  const missesOnlyLate = firstMissIndex !== null ? firstMissIndex >= setCount - 2 : false;
  const allHit = missesCount === 0 && setCount > 0;

  const firstActual = setCount ? a[0] : null;
  const lastActual = setCount ? a[setCount - 1] : null;
  const dropRatioLastToFirst =
    firstActual && lastActual != null ? lastActual / Math.max(1, firstActual) : null;

  return {
    setCount,
    targets: t,
    actuals: a,
    totalTarget,
    totalActual,
    ratio,
    missesCount,
    firstMissIndex,
    missesOnlyLate,
    allHit,
    dropRatioLastToFirst,
  };
}

function computeSubmaxNextState({ testMax, plan, result, currentWorkReps, currentRestSec, currentDropStreak }) {
  const analysis = analyzeSubmaxSession({ plan, result });

  const workRepsNow = clampInt(currentWorkReps, 1, testMax) || 1;
  const restNow = clampRestSec(currentRestSec) || 150;
  const dropStreakNow = clampInt(currentDropStreak, 0, 99) || 0;

  if (!analysis.setCount || !analysis.totalTarget || analysis.ratio == null) {
    return {
      nextWorkReps: workRepsNow,
      nextRestSec: restNow,
      nextDropStreak: 0,
      decision: 'keep',
      analysis,
    };
  }

  const ratio = analysis.ratio;
  const bigDrop = analysis.dropRatioLastToFirst != null && analysis.dropRatioLastToFirst < 0.75;
  const willBeDropStreak = bigDrop ? dropStreakNow + 1 : 0;

  const nearMiss =
    analysis.missesCount > 0 &&
    analysis.missesCount <= 2 &&
    analysis.missesOnlyLate &&
    ratio >= 0.85;

  // Prefer: adjust rest/reps for *next* pass (not mid-session).
  // Priority:
  // 1) Persistent big drop (2 passes) => reduce target reps (keep rest stable)
  // 2) Near-miss late => keep reps, increase baseline rest
  // 3) Solid completion => increase reps
  // 4) Early failure / very low ratio => reduce reps
  let nextWorkReps = workRepsNow;
  let nextRestSec = restNow;
  let nextDropStreak = willBeDropStreak;
  let decision = 'keep';

  if (bigDrop && willBeDropStreak >= 2) {
    const delta = analysis.dropRatioLastToFirst != null && analysis.dropRatioLastToFirst < 0.65 ? 2 : 1;
    nextWorkReps = workRepsNow - delta;
    nextDropStreak = 0;
    decision = 'decrease_reps_due_to_drop_streak';
  } else if (nearMiss) {
    nextRestSec = restNow + 30;
    decision = 'increase_rest';
  } else if (analysis.allHit && ratio >= 0.95) {
    nextWorkReps = workRepsNow + 1;
    nextDropStreak = 0;
    decision = 'increase_reps';
  } else if (ratio < 0.7 || (analysis.firstMissIndex != null && analysis.firstMissIndex <= 2)) {
    const delta = ratio < 0.55 ? 2 : 1;
    nextWorkReps = workRepsNow - delta;
    nextDropStreak = 0;
    decision = 'decrease_reps';
  }

  return {
    nextWorkReps: clampInt(nextWorkReps, 1, testMax) || 1,
    nextRestSec: clampRestSec(nextRestSec) || 150,
    nextDropStreak: clampInt(nextDropStreak, 0, 99) || 0,
    decision,
    analysis,
  };
}

function computeLadderNextTop({ plan, result, currentTop }) {
  const steps = (plan?.ladders?.[0]?.steps || []).map((n) => Number(n)).filter(Boolean);
  const top = steps.length ? steps[steps.length - 1] : clampInt(currentTop, 3, 20) || 3;
  const completedSteps = Array.isArray(result?.steps)
    ? result.steps.map((n) => Number(n)).filter(Boolean)
    : [];

  const didFullLadder =
    completedSteps.length === steps.length &&
    steps.every((value, idx) => completedSteps[idx] === value);

  const next = didFullLadder ? top + 1 : top;
  return clampInt(next, 3, 20) || 3;
}

router.post('/program-days/:id/complete', authRequired, (req, res) => {
  const resultJson = req.body?.result_json;
  const durationSec = clampInt(req.body?.duration_sec, 0, 60 * 60 * 12);
  if (!resultJson || typeof resultJson !== 'object') {
    return res.status(400).json({ error: 'result_json krävs' });
  }

  const row = db
    .prepare(
      `SELECT d.id AS day_id, d.program_id, d.date, d.day_type, d.status, d.plan_json,
              p.id AS program_id2, p.exercise_key, p.method, p.test_max, p.schedule_json, p.state_json, p.active
       FROM progressive_program_days d
       JOIN progressive_programs p ON p.id = d.program_id
       WHERE d.id = ? AND p.user_id = ?`
    )
    .get(req.params.id, req.user.id);

  if (!row) return res.status(404).json({ error: 'Programdagen finns inte' });
  if (row.status !== 'planned') {
    return res.status(400).json({ error: 'Programdagen är redan hanterad' });
  }
  if (row.day_type !== 'workout') {
    return res.status(400).json({ error: 'Endast workout-dagar kan slutföras här (v1)' });
  }

  const plan = safeJsonParse(row.plan_json);
  const state = safeJsonParse(row.state_json) || {};
  const method = row.method;

  const testMax = clampInt(row.test_max, 1, 1000) || 1;
  let nextState = { ...state, test_max: testMax };

  if (method === 'submax') {
    const currentWorkReps = clampInt(state.work_reps, 1, testMax) || 1;
    const currentRestSec = clampRestSec(state.rest_sec) || 150;
    const currentDropStreak = clampInt(state.drop_streak, 0, 99) || 0;

    const { nextWorkReps, nextRestSec, nextDropStreak, decision, analysis } = computeSubmaxNextState({
      testMax,
      plan,
      result: resultJson,
      currentWorkReps,
      currentRestSec,
      currentDropStreak,
    });

    nextState = {
      ...nextState,
      method,
      exercise_key: row.exercise_key,
      work_reps: nextWorkReps,
      rest_sec: nextRestSec,
      drop_streak: nextDropStreak,
      version: Math.max(2, clampInt(state.version, 1, 99) || 1),
    };

    // Store inference with the completed session for transparency/debugging.
    resultJson.inference = resultJson.inference || {
      method: 'submax',
      ratio: analysis.ratio,
      drop_ratio_last_to_first: analysis.dropRatioLastToFirst,
      misses_count: analysis.missesCount,
      decision,
      next: { work_reps: nextWorkReps, rest_sec: nextRestSec },
    };
  } else if (method === 'ladder') {
    const currentTop = clampInt(state.top, 3, 20) || 3;
    const nextTop = computeLadderNextTop({ plan, result: resultJson, currentTop });
    nextState = { ...nextState, method, exercise_key: row.exercise_key, top: nextTop };
  } else {
    return res.status(400).json({ error: 'Okänd metod' });
  }

  const nowIso = new Date().toISOString();
  const enrichedResult = { ...resultJson, completed_at: resultJson.completed_at || nowIso };

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE progressive_program_days
       SET status = 'done', result_json = ?
       WHERE id = ?`
    ).run(JSON.stringify(enrichedResult), row.day_id);

    db.prepare(`UPDATE progressive_programs SET state_json = ? WHERE id = ?`).run(
      JSON.stringify(nextState),
      row.program_id2
    );

    const existing = db
      .prepare('SELECT id FROM workout_sessions WHERE program_day_id = ? LIMIT 1')
      .get(row.day_id);
    if (!existing) {
      const endIso = nowIso;
      const startIso =
        durationSec !== null
          ? new Date(new Date(endIso).getTime() - durationSec * 1000).toISOString()
          : endIso;
      const workoutId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO workout_sessions
          (id, user_id, template_id, session_type, started_at, ended_at, duration_sec, notes, source, treadmill_state_json, program_day_id)
         VALUES (?, ?, NULL, 'progressive', ?, ?, ?, '', 'manual', NULL, ?)`
      ).run(workoutId, req.user.id, startIso, endIso, durationSec, row.day_id);
    }

    const nextDay = db
      .prepare(
        `SELECT id
         FROM progressive_program_days
         WHERE program_id = ?
           AND date(date) > date(?)
           AND day_type = 'workout'
           AND status = 'planned'
         ORDER BY date ASC
         LIMIT 1`
      )
      .get(row.program_id2, row.date);

    if (nextDay?.id) {
      const nextPlan = planForWorkout(nextState);
      db.prepare(`UPDATE progressive_program_days SET plan_json = ? WHERE id = ?`).run(
        nextPlan ? JSON.stringify(nextPlan) : null,
        nextDay.id
      );
    }
  });

  try {
    tx();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Kunde inte spara resultat' });
  }

  res.json({ ok: true });
});

router.post('/program-days/:id/test', authRequired, (req, res) => {
  const testMax = clampInt(req.body?.test_max, 1, 1000);
  if (!testMax) return res.status(400).json({ error: 'test_max måste vara ett heltal >= 1' });

  const row = db
    .prepare(
      `SELECT d.id AS day_id, d.program_id, d.date, d.day_type, d.status,
              p.id AS program_id2, p.exercise_key, p.method, p.test_max, p.schedule_json, p.state_json, p.active
       FROM progressive_program_days d
       JOIN progressive_programs p ON p.id = d.program_id
       WHERE d.id = ? AND p.user_id = ?`
    )
    .get(req.params.id, req.user.id);

  if (!row) return res.status(404).json({ error: 'Programdagen finns inte' });
  if (row.status !== 'planned') return res.status(400).json({ error: 'Programdagen är redan hanterad' });
  if (row.day_type !== 'test') return res.status(400).json({ error: 'Detta är inte en testdag' });

  const schedule = safeJsonParse(row.schedule_json) || {};
  const preferredDays = Array.isArray(schedule.preferred_days) ? schedule.preferred_days : [];
  const testEveryWeeks = clampInt(schedule.test_every_weeks, 1, 12) || 4;

  const nextState = initialStateFromTestMax({
    method: row.method,
    exerciseKey: row.exercise_key,
    testMax,
  });

  const nowIso = new Date().toISOString();
  const result = { test_max: testMax, completed_at: nowIso };

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE progressive_program_days
       SET status = 'done', result_json = ?
       WHERE id = ?`
    ).run(JSON.stringify(result), row.day_id);

    db.prepare(
      `UPDATE progressive_programs
       SET test_max = ?, state_json = ?
       WHERE id = ?`
    ).run(testMax, JSON.stringify(nextState), row.program_id2);

    const nextStart = new Date(`${row.date}T00:00:00.000Z`);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const nextStartIso = isoDateUTC(nextStart);
    const newDays = generateProgramDaysFromIsoDate({
      programId: row.program_id2,
      exerciseKey: row.exercise_key,
      preferredDays,
      testEveryWeeks,
      state: nextState,
      startIsoDate: nextStartIso,
    });
    insertProgramDays(newDays);

    const nextWorkout = db
      .prepare(
        `SELECT id
         FROM progressive_program_days
         WHERE program_id = ?
           AND date(date) > date(?)
           AND day_type = 'workout'
           AND status = 'planned'
         ORDER BY date ASC
         LIMIT 1`
      )
      .get(row.program_id2, row.date);

    if (nextWorkout?.id) {
      const nextPlan = planForWorkout(nextState);
      db.prepare(`UPDATE progressive_program_days SET plan_json = ? WHERE id = ?`).run(
        nextPlan ? JSON.stringify(nextPlan) : null,
        nextWorkout.id
      );
    }
  });

  try {
    tx();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Kunde inte spara test' });
  }

  res.json({ ok: true });
});

module.exports = {
  router,
};
