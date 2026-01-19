/**
 * MET (Metabolic Equivalent of Task) tables and calorie calculation
 * Reference: Compendium of Physical Activities
 */

// MET values by activity_type and intensity
const ACTIVITY_MET = {
  running: { low: 7.0, medium: 9.8, high: 12.3 },      // 8km/h, 10km/h, 12km/h
  hiit: { low: 6.0, medium: 8.5, high: 10.0 },
  strength: { low: 3.5, medium: 5.0, high: 6.0 },
  calisthenics: { low: 4.0, medium: 6.0, high: 8.0 },  // pushups, pullups, dips
  mobility: { low: 2.5, medium: 3.0, high: 4.0 },      // stretching, yoga
  core: { low: 3.5, medium: 4.5, high: 5.5 },          // abs, plank
  isometric: { low: 2.5, medium: 3.5, high: 4.5 },     // holds, dead hang
  other: { low: 3.0, medium: 4.0, high: 5.0 },
};

// MET values by specific exercise_tag (overrides activity_type)
const EXERCISE_MET = {
  // Calisthenics
  pushup: 6.0,
  diamond_pushup: 6.5,
  slow_pushup: 5.0,
  decline_pushup: 6.5,
  incline_pushup: 5.0,
  pike_pushup: 6.0,
  pullup: 8.0,
  chinup: 7.5,
  dip: 7.0,
  muscle_up: 9.0,
  burpee: 9.5,
  jumping_jack: 7.0,
  mountain_climber: 8.0,
  
  // Lower body
  squat: 5.5,
  pistol_squat: 7.0,
  lunge: 6.0,
  box_jump: 8.5,
  jump_squat: 8.0,
  
  // Core
  plank: 4.0,
  side_plank: 4.0,
  crunch: 4.5,
  situp: 5.0,
  leg_raise: 4.5,
  russian_twist: 5.0,
  
  // Isometric
  dead_hang: 3.0,
  wall_sit: 3.5,
  l_sit: 5.0,
  
  // Cardio
  run: 9.8,
  sprint: 14.0,
  walk: 3.5,
  bike: 7.5,
  rowing: 7.0,
  jump_rope: 11.0,
  
  // Weights (general)
  barbell_curl: 5.0,
  deadlift: 6.0,
  bench_press: 5.0,
  overhead_press: 5.0,
  kettlebell_swing: 9.0,
};

// Time per rep (seconds) for duration estimation
const SEC_PER_REP = {
  pushup: 2.0,
  diamond_pushup: 2.2,
  slow_pushup: 4.0,
  decline_pushup: 2.0,
  incline_pushup: 2.0,
  pike_pushup: 2.5,
  pullup: 2.5,
  chinup: 2.5,
  dip: 2.5,
  muscle_up: 4.0,
  burpee: 3.5,
  jumping_jack: 1.0,
  mountain_climber: 0.5,
  squat: 2.0,
  pistol_squat: 4.0,
  lunge: 2.0,
  box_jump: 3.0,
  jump_squat: 2.5,
  crunch: 1.5,
  situp: 2.0,
  leg_raise: 2.0,
  russian_twist: 1.0,
  barbell_curl: 3.0,
  deadlift: 4.0,
  bench_press: 3.0,
  overhead_press: 3.0,
  kettlebell_swing: 2.0,
  // Default for unknown exercises
  default: 2.0,
};

// Transition time between sets (seconds)
const TRANSITION_SEC = 12;

/**
 * Get MET value for an activity
 * @param {string} activityType - normalized activity type
 * @param {string} exerciseTag - specific exercise tag (optional)
 * @param {string} intensity - low/medium/high (default: medium)
 * @returns {number} MET value
 */
function getMET(activityType, exerciseTag = null, intensity = 'medium') {
  // First try specific exercise
  if (exerciseTag && EXERCISE_MET[exerciseTag]) {
    return EXERCISE_MET[exerciseTag];
  }
  
  // Fall back to activity type
  const activityMets = ACTIVITY_MET[activityType] || ACTIVITY_MET.other;
  return activityMets[intensity] || activityMets.medium;
}

/**
 * Calculate calories burned
 * Formula: kcal/min = MET * 3.5 * weight_kg / 200
 * @param {number} met - MET value
 * @param {number} durationSec - duration in seconds
 * @param {number} weightKg - body weight in kg
 * @returns {{ kcalTotal: number, kcalActive: number }}
 */
function calculateKcal(met, durationSec, weightKg) {
  const minutes = durationSec / 60;
  const kcalPerMin = (met * 3.5 * weightKg) / 200;
  const kcalTotal = kcalPerMin * minutes;
  
  // Active kcal excludes resting metabolic rate (MET=1)
  const activeMet = Math.max(0, met - 1);
  const activeKcalPerMin = (activeMet * 3.5 * weightKg) / 200;
  const kcalActive = activeKcalPerMin * minutes;
  
  return {
    kcalTotal: Math.round(kcalTotal * 10) / 10,
    kcalActive: Math.round(kcalActive * 10) / 10,
  };
}

/**
 * Get seconds per rep for an exercise
 */
function getSecPerRep(exerciseTag) {
  return SEC_PER_REP[exerciseTag] || SEC_PER_REP.default;
}

module.exports = {
  ACTIVITY_MET,
  EXERCISE_MET,
  SEC_PER_REP,
  TRANSITION_SEC,
  getMET,
  calculateKcal,
  getSecPerRep,
};

