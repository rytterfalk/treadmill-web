/**
 * Duration estimation from various sources
 * Priority: A) provided duration, B) parsed text, C) reps→time, D) fallback
 */

const { getSecPerRep, TRANSITION_SEC } = require('./met-tables');
const { normalizeExerciseTag } = require('./activity-normalizer');

// Default fallback duration (10 minutes)
const FALLBACK_DURATION_SEC = 10 * 60;

/**
 * Parse duration from text (e.g., "15 min", "30 minuter", "1h 20min")
 * @param {string} text
 * @returns {{ durationSec: number, method: string } | null}
 */
function parseDurationFromText(text) {
  if (!text) return null;
  
  // Match "X min" or "X minuter" or "Xmin"
  const minMatch = text.match(/(\d+)\s*min(ut(er)?)?/i);
  if (minMatch) {
    const minutes = parseInt(minMatch[1], 10);
    return { durationSec: minutes * 60, method: 'parsed_text' };
  }
  
  // Match "X h" or "X timmar" optionally with minutes
  const hourMatch = text.match(/(\d+)\s*(h|timm?a?r?)\s*(\d+)?\s*(min)?/i);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    const mins = hourMatch[3] ? parseInt(hourMatch[3], 10) : 0;
    return { durationSec: hours * 3600 + mins * 60, method: 'parsed_text' };
  }
  
  // Match "X sek" or "X sekunder"
  const secMatch = text.match(/(\d+)\s*sek(und(er)?)?/i);
  if (secMatch) {
    return { durationSec: parseInt(secMatch[1], 10), method: 'parsed_text' };
  }
  
  return null;
}

/**
 * Parse distance from text (e.g., "5km", "4 km på 25 min", "2.5 km")
 * @param {string} text
 * @returns {{ distanceM: number, durationSec?: number, method: string } | null}
 */
function parseDistanceFromText(text) {
  if (!text) return null;
  
  // Match "X km på Y min"
  const kmTimeMatch = text.match(/(\d+([.,]\d+)?)\s*km\s*(på|i|in)\s*(\d+)\s*min/i);
  if (kmTimeMatch) {
    const km = parseFloat(kmTimeMatch[1].replace(',', '.'));
    const minutes = parseInt(kmTimeMatch[4], 10);
    return {
      distanceM: Math.round(km * 1000),
      durationSec: minutes * 60,
      method: 'parsed_text',
    };
  }
  
  // Match just "X km" or "X.X km"
  const kmMatch = text.match(/(\d+([.,]\d+)?)\s*km/i);
  if (kmMatch) {
    const km = parseFloat(kmMatch[1].replace(',', '.'));
    return {
      distanceM: Math.round(km * 1000),
      method: 'parsed_text',
    };
  }
  
  // Match "X m" (meters)
  const mMatch = text.match(/(\d+)\s*m\b/i);
  if (mMatch) {
    return {
      distanceM: parseInt(mMatch[1], 10),
      method: 'parsed_text',
    };
  }
  
  return null;
}

/**
 * Estimate duration from reps/sets
 * @param {number} reps - total reps
 * @param {number} sets - number of sets
 * @param {string} exerciseText - exercise name for tag lookup
 * @returns {{ durationSec: number, method: string }}
 */
function estimateDurationFromReps(reps, sets, exerciseText) {
  const exerciseTag = normalizeExerciseTag(exerciseText);
  const secPerRep = getSecPerRep(exerciseTag);
  
  // Time = reps * sec_per_rep + sets * transition_time
  const repTime = reps * secPerRep;
  const transitionTime = sets * TRANSITION_SEC;
  
  return {
    durationSec: Math.round(repTime + transitionTime),
    method: 'reps_to_time',
  };
}

/**
 * Get duration for a workout/challenge with full estimation logic
 * @param {Object} data - workout or challenge data
 * @param {number} data.duration_sec - provided duration
 * @param {string} data.notes - workout notes
 * @param {string} data.exercise - exercise name
 * @param {string} data.title - workout title
 * @param {number} data.total_reps - total reps (for challenges)
 * @param {number} data.sets_count - number of sets (for challenges)
 * @param {number} data.total_seconds - total seconds (for timed challenges)
 * @param {boolean} data.is_timed - whether it's a timed challenge
 * @returns {{ durationSec: number, distanceM?: number, method: string, isEstimated: boolean }}
 */
function getDuration(data) {
  // A) Provided duration
  if (data.duration_sec && data.duration_sec > 0) {
    return {
      durationSec: data.duration_sec,
      method: 'provided_duration',
      isEstimated: false,
    };
  }
  
  // For timed challenges, use total_seconds
  if (data.is_timed && data.total_seconds && data.total_seconds > 0) {
    return {
      durationSec: data.total_seconds,
      method: 'provided_duration',
      isEstimated: false,
    };
  }
  
  // B) Parse from text (notes, title, exercise)
  const textSources = [data.notes, data.title, data.exercise].filter(Boolean);
  for (const text of textSources) {
    // Try distance with duration first
    const distanceResult = parseDistanceFromText(text);
    if (distanceResult && distanceResult.durationSec) {
      return {
        durationSec: distanceResult.durationSec,
        distanceM: distanceResult.distanceM,
        method: distanceResult.method,
        isEstimated: true,
      };
    }
    
    // Try just duration
    const durationResult = parseDurationFromText(text);
    if (durationResult) {
      return {
        durationSec: durationResult.durationSec,
        distanceM: distanceResult?.distanceM,
        method: durationResult.method,
        isEstimated: true,
      };
    }
  }
  
  // C) Estimate from reps/sets
  if (data.total_reps && data.total_reps > 0 && data.sets_count && data.sets_count > 0) {
    const result = estimateDurationFromReps(data.total_reps, data.sets_count, data.exercise);
    return {
      ...result,
      isEstimated: true,
    };
  }
  
  // D) Fallback
  return {
    durationSec: FALLBACK_DURATION_SEC,
    method: 'fallback',
    isEstimated: true,
  };
}

module.exports = {
  parseDurationFromText,
  parseDistanceFromText,
  estimateDurationFromReps,
  getDuration,
  FALLBACK_DURATION_SEC,
};

