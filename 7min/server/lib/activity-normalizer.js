/**
 * Normalize activity types and exercise tags from various inputs
 */

// Map session_type to normalized activity_type
const SESSION_TYPE_MAP = {
  hiit: 'hiit',
  strength: 'strength',
  run: 'running',
  mobility: 'mobility',
  test: 'other',
  other: 'other',
  treadmill: 'running',
  progressive: 'calisthenics',
  circuit: 'hiit',
};

// Keywords to detect activity type from title/exercise text
const ACTIVITY_KEYWORDS = {
  running: ['löp', 'run', 'sprint', 'jogg', 'km', 'mil'],
  hiit: ['hiit', 'interval', 'tabata', 'emom', 'amrap', 'wod'],
  strength: ['styrka', 'vikt', 'skivstång', 'hantel', 'deadlift', 'bänk', 'press', 'curl'],
  calisthenics: ['armhäv', 'pushup', 'push-up', 'pullup', 'pull-up', 'dips', 'chins', 'burpee', 'lyfta'],
  core: ['mage', 'core', 'plank', 'crunch', 'situp', 'sit-up', 'magpass'],
  mobility: ['stretch', 'yoga', 'rörlighet', 'mobility'],
  isometric: ['hang', 'häng', 'hold', 'håll', 'l-sit', 'wall sit'],
};

// Map exercise text to normalized exercise_tag
const EXERCISE_TAG_PATTERNS = [
  // Pushup variants
  { pattern: /diamond.*(push|häv)/i, tag: 'diamond_pushup' },
  { pattern: /decline.*(push|häv)/i, tag: 'decline_pushup' },
  { pattern: /incline.*(push|häv)/i, tag: 'incline_pushup' },
  { pattern: /pike.*(push|häv)/i, tag: 'pike_pushup' },
  { pattern: /slow.*(push|häv)/i, tag: 'slow_pushup' },
  { pattern: /(push.?up|armhäv)/i, tag: 'pushup' },
  
  // Pull variants
  { pattern: /(pull.?up|pullups)/i, tag: 'pullup' },
  { pattern: /(chin.?up|chins)/i, tag: 'chinup' },
  { pattern: /muscle.?up/i, tag: 'muscle_up' },
  
  // Other upper body
  { pattern: /dip/i, tag: 'dip' },
  { pattern: /burpee/i, tag: 'burpee' },
  
  // Lower body
  { pattern: /pistol/i, tag: 'pistol_squat' },
  { pattern: /jump.?squat/i, tag: 'jump_squat' },
  { pattern: /squat/i, tag: 'squat' },
  { pattern: /lunge|utfall/i, tag: 'lunge' },
  { pattern: /box.?jump/i, tag: 'box_jump' },
  
  // Core
  { pattern: /plank/i, tag: 'plank' },
  { pattern: /crunch/i, tag: 'crunch' },
  { pattern: /sit.?up/i, tag: 'situp' },
  { pattern: /leg.?raise|benhäv/i, tag: 'leg_raise' },
  { pattern: /russian.?twist/i, tag: 'russian_twist' },
  { pattern: /mage|magpass|core/i, tag: 'core' },
  
  // Isometric
  { pattern: /dead.?hang|häng/i, tag: 'dead_hang' },
  { pattern: /wall.?sit/i, tag: 'wall_sit' },
  { pattern: /l.?sit/i, tag: 'l_sit' },
  
  // Cardio
  { pattern: /spring|sprint/i, tag: 'sprint' },
  { pattern: /löp|run|jogg/i, tag: 'run' },
  { pattern: /cykel|bike/i, tag: 'bike' },
  { pattern: /rodd|row/i, tag: 'rowing' },
  { pattern: /hopprep|jump.?rope/i, tag: 'jump_rope' },
  
  // Weights
  { pattern: /curl|21an/i, tag: 'barbell_curl' },
  { pattern: /deadlift|marklyft/i, tag: 'deadlift' },
  { pattern: /bänk|bench/i, tag: 'bench_press' },
  { pattern: /press|axelpress/i, tag: 'overhead_press' },
  { pattern: /kettle/i, tag: 'kettlebell_swing' },
  
  // Misc
  { pattern: /lyfta.*(william|barn)/i, tag: 'strength' }, // "lyfta William över huvudet"
  { pattern: /mountain.?climber/i, tag: 'mountain_climber' },
  { pattern: /jumping.?jack/i, tag: 'jumping_jack' },
];

/**
 * Normalize activity type from session data
 * @param {string} sessionType - database session_type
 * @param {string} title - workout title or exercise name
 * @returns {string} normalized activity type
 */
function normalizeActivityType(sessionType, title = '') {
  // First check title for keywords
  const lowerTitle = (title || '').toLowerCase();
  
  for (const [activityType, keywords] of Object.entries(ACTIVITY_KEYWORDS)) {
    if (keywords.some(kw => lowerTitle.includes(kw))) {
      return activityType;
    }
  }
  
  // Fall back to session type mapping
  return SESSION_TYPE_MAP[sessionType] || 'other';
}

/**
 * Extract exercise tag from exercise text
 * @param {string} exerciseText - exercise name/description
 * @returns {string|null} normalized exercise tag or null
 */
function normalizeExerciseTag(exerciseText) {
  if (!exerciseText) return null;
  
  for (const { pattern, tag } of EXERCISE_TAG_PATTERNS) {
    if (pattern.test(exerciseText)) {
      return tag;
    }
  }
  
  return null;
}

/**
 * Detect intensity from text
 * @param {string} text - workout title or notes
 * @returns {string} low/medium/high
 */
function detectIntensity(text) {
  if (!text) return 'medium';
  const lower = text.toLowerCase();
  
  if (/lätt|easy|low|lugn|vila/i.test(lower)) return 'low';
  if (/hård|tough|high|max|intense|vigorous|explosiv/i.test(lower)) return 'high';
  
  return 'medium';
}

module.exports = {
  normalizeActivityType,
  normalizeExerciseTag,
  detectIntensity,
  ACTIVITY_KEYWORDS,
  SESSION_TYPE_MAP,
};

