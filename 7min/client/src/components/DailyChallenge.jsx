import { useState, useEffect, useCallback, useRef } from 'react';

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 tim' },
];

// Presets for timed challenges (in seconds)
const TIMED_PRESETS = [
  { value: 30, label: '30 sek' },
  { value: 60, label: '1 min' },
  { value: 90, label: '1:30' },
  { value: 120, label: '2 min' },
  { value: 150, label: '2:30' },
  { value: 0, label: 'Kör bara kör!' }, // 0 = unlimited/stopwatch mode
];

const MAX_CHALLENGES = 3;
const TIMER_STORAGE_KEY = '7min_challenge_timers'; // Local timers only
const COUNTDOWN_SECONDS = 5; // Countdown before timed challenge starts

// Audio context for beep sounds (lazy init)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Play a beep sound
function playBeep(frequency = 800, duration = 0.15, volume = 0.3) {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch (e) {
    // Audio not available
  }
}

// Short beep for countdown
function playCountdownBeep() {
  playBeep(600, 0.1, 0.25);
}

// Longer beep for GO!
function playStartBeep() {
  playBeep(900, 0.3, 0.4);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Något gick fel');
  return data;
}

function getNextAlignedTime(intervalMins, afterTime = Date.now()) {
  // For intervals >= 60min, don't try to align to clock - just add the interval
  if (intervalMins >= 60) {
    return afterTime + intervalMins * 60 * 1000;
  }
  // For shorter intervals, align to clock (e.g. :00, :15, :30, :45 for 15min)
  const d = new Date(afterTime);
  const mins = d.getMinutes();
  const alignedMinute = Math.ceil(mins / intervalMins) * intervalMins;
  d.setMinutes(alignedMinute, 0, 0);
  if (d.getTime() <= afterTime) d.setMinutes(d.getMinutes() + intervalMins);
  return d.getTime();
}

const DAY_NAMES = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'idag';
  if (d.toDateString() === yesterday.toDateString()) return 'igår';
  return DAY_NAMES[d.getDay()];
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return `${m} min`;
}

// Format seconds as mm:ss or just seconds for short durations
function formatTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '0:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Format total seconds for display in stats (e.g., "2:30" or "45 sek")
function formatTimeStats(totalSeconds) {
  if (!totalSeconds) return '0 sek';
  if (totalSeconds < 60) return `${totalSeconds} sek`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (secs === 0) return `${mins} min`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function DailyChallenge({ onSaveDay, currentUserId }) {
  const [challenges, setChallenges] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [history, setHistory] = useState({ dates: [], challenges: [], workouts: [] });
  const [activity, setActivity] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [exercise, setExercise] = useState('');
  const [targetReps, setTargetReps] = useState(30);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [countdowns, setCountdowns] = useState({});
  const [timers, setTimers] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) || '{}'); } catch { return {}; }
  });
  const [modalChallengeId, setModalChallengeId] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [actualReps, setActualReps] = useState(0);
  const [bulkSets, setBulkSets] = useState('1');
  const [modalSets, setModalSets] = useState([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [lastActivityCheck, setLastActivityCheck] = useState(() => new Date().toISOString());

  // New state for timed challenges
  const [isTimed, setIsTimed] = useState(false); // Toggle for reps vs time
  const [targetSeconds, setTargetSeconds] = useState(60); // Target time for timed challenges
  const [activeTimer, setActiveTimer] = useState(null); // { challengeId, phase: 'countdown'|'running', startTime, targetSeconds }
  const [timerDisplay, setTimerDisplay] = useState(0); // Current timer value in seconds
  const [actualSeconds, setActualSeconds] = useState(0); // For logging timed sets
  const [confirmEndId, setConfirmEndId] = useState(null); // Challenge ID pending end confirmation

  // Ref to track last beeped second (to avoid duplicate beeps)
  const lastBeepRef = useRef(-1);

  // Load challenges from backend and sync timers
  const loadChallenges = useCallback(async () => {
    try {
      const { challenges: data } = await api('/api/challenges/my');
      setChallenges(data || []);

      // Sync timers from server data (for cross-device sync)
      if (data && data.length > 0) {
        setTimers(prev => {
          const newTimers = { ...prev };
          data.forEach(c => {
            // If we don't have a timer for this challenge, calculate from server data
            if (!newTimers[c.id]) {
              if (c.last_set_at) {
                // Calculate next timer based on last set + interval
                const lastSetTime = new Date(c.last_set_at).getTime();
                newTimers[c.id] = getNextAlignedTime(c.interval_minutes, lastSetTime);
              } else {
                // No sets yet - timer should be now (ready to do first set)
                newTimers[c.id] = Date.now();
              }
            }
          });
          return newTimers;
        });
      }
    } catch (err) {
      console.error('Failed to load challenges:', err);
    }
  }, []);

  // Load leaderboard
  const loadLeaderboard = useCallback(async () => {
    try {
      const { leaderboard: data } = await api('/api/challenges/leaderboard');
      setLeaderboard(data || []);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  }, []);

  // Load weekly history
  const loadHistory = useCallback(async () => {
    try {
      const data = await api('/api/challenges/history');
      setHistory(data || { dates: [], challenges: [], workouts: [] });
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }, []);

  // Check for new activity (notifications)
  const checkActivity = useCallback(async () => {
    try {
      const { activity: data } = await api(`/api/challenges/activity?since=${encodeURIComponent(lastActivityCheck)}`);
      if (data && data.length > 0) {
        setActivity(prev => [...data, ...prev].slice(0, 10));
        setLastActivityCheck(new Date().toISOString());
      }
    } catch (err) {
      console.error('Failed to check activity:', err);
    }
  }, [lastActivityCheck]);

  // Initial load
  useEffect(() => {
    loadChallenges();
    loadLeaderboard();
    loadHistory();
  }, [loadChallenges, loadLeaderboard, loadHistory]);

  // Refresh when page becomes visible (PWA wake, tab focus)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        loadChallenges();
        loadLeaderboard();
        loadHistory();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadChallenges, loadLeaderboard, loadHistory]);

  // Poll for activity and challenges every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      checkActivity();
      loadLeaderboard();
      loadChallenges();
    }, 30000);
    return () => clearInterval(interval);
  }, [checkActivity, loadLeaderboard, loadChallenges]);

  // Save timers to localStorage
  useEffect(() => {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timers));
  }, [timers]);

  // Countdown timers
  useEffect(() => {
    if (challenges.length === 0) { setCountdowns({}); return; }
    function updateCountdowns() {
      const now = Date.now();
      const newCountdowns = {};
      challenges.forEach((c) => {
        const nextTime = timers[c.id] || now;
        const diff = nextTime - now;
        newCountdowns[c.id] = diff <= 0
          ? { minutes: 0, seconds: 0, ready: true }
          : { minutes: Math.floor(diff / 60000), seconds: Math.floor((diff % 60000) / 1000), ready: false };
      });
      setCountdowns(newCountdowns);
    }
    updateCountdowns();
    const interval = setInterval(updateCountdowns, 1000);
    return () => clearInterval(interval);
  }, [challenges, timers]);

  // Active timer effect (for timed challenges)
  useEffect(() => {
    if (!activeTimer) {
      lastBeepRef.current = -1; // Reset beep tracker when timer stops
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - activeTimer.startTime) / 1000);

      if (activeTimer.phase === 'countdown') {
        const remaining = COUNTDOWN_SECONDS - elapsed;
        if (remaining <= 0) {
          // Transition to running phase - play start beep
          if (lastBeepRef.current !== 0) {
            playStartBeep();
            lastBeepRef.current = 0;
          }
          setActiveTimer(prev => ({ ...prev, phase: 'running', startTime: Date.now() }));
          setTimerDisplay(0);
        } else {
          // Play countdown beep for each second (3, 2, 1)
          if (remaining <= 3 && remaining !== lastBeepRef.current) {
            playCountdownBeep();
            lastBeepRef.current = remaining;
          }
          setTimerDisplay(remaining);
        }
      } else {
        // Running phase
        if (activeTimer.targetSeconds > 0 && elapsed >= activeTimer.targetSeconds) {
          // Time's up! Auto-complete
          completeTimedSet(activeTimer.challengeId, activeTimer.targetSeconds);
        } else {
          setTimerDisplay(elapsed);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [activeTimer]);

  async function addChallenge() {
    if (challenges.length >= MAX_CHALLENGES || !exercise.trim()) return;
    try {
      const { challenge } = await api('/api/challenges', {
        method: 'POST',
        body: JSON.stringify({
          exercise,
          targetReps: isTimed ? 0 : targetReps,
          intervalMinutes,
          isTimed,
          targetSeconds: isTimed ? targetSeconds : null
        }),
      });
      setChallenges([...challenges, challenge]);
      setTimers({ ...timers, [challenge.id]: Date.now() }); // First set is now
      setShowSetup(false);
      setExercise('');
      setIsTimed(false);
      loadLeaderboard();
    } catch (err) {
      alert(err.message);
    }
  }

  // Start timed challenge (5 sec countdown then main timer)
  function startTimedChallenge(challengeId, targetSec) {
    setActiveTimer({
      challengeId,
      phase: 'countdown',
      startTime: Date.now(),
      targetSeconds: targetSec
    });
    setTimerDisplay(COUNTDOWN_SECONDS);
  }

  // Stop timer and log the time
  async function stopTimedChallenge() {
    if (!activeTimer || activeTimer.phase !== 'running') {
      setActiveTimer(null);
      return;
    }
    const elapsed = Math.floor((Date.now() - activeTimer.startTime) / 1000);
    await completeTimedSet(activeTimer.challengeId, elapsed);
  }

  // Complete a timed set
  async function completeTimedSet(challengeId, seconds) {
    const c = challenges.find(ch => ch.id === challengeId);
    if (!c) return;
    try {
      const result = await api(`/api/challenges/${challengeId}/sets`, {
        method: 'POST',
        body: JSON.stringify({ seconds }),
      });
      setChallenges(challenges.map(ch =>
        ch.id === challengeId ? { ...ch, sets_count: result.sets_count, total_seconds: result.total_seconds } : ch
      ));
      setTimers({ ...timers, [challengeId]: getNextAlignedTime(c.interval_minutes, Date.now()) });
      setActiveTimer(null);
      loadLeaderboard();
      loadHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  async function logSet(challengeId, reps, seconds = null) {
    const c = challenges.find(ch => ch.id === challengeId);
    if (!c) return;
    try {
      const result = await api(`/api/challenges/${challengeId}/sets`, {
        method: 'POST',
        body: JSON.stringify({ reps, seconds }),
      });
      setChallenges(challenges.map(ch =>
        ch.id === challengeId ? { ...ch, sets_count: result.sets_count, total_reps: result.total_reps, total_seconds: result.total_seconds } : ch
      ));
      setTimers({ ...timers, [challengeId]: getNextAlignedTime(c.interval_minutes, Date.now()) });
      closeModal();
      loadLeaderboard();
      loadHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  async function addBulkSets(challengeId, numSets, repsOrSeconds) {
    const c = challenges.find(ch => ch.id === challengeId);
    const n = parseInt(numSets, 10) || 0;
    if (n <= 0) return;
    try {
      for (let i = 0; i < n; i++) {
        await api(`/api/challenges/${challengeId}/sets`, {
          method: 'POST',
          body: JSON.stringify({
            reps: c?.is_timed ? 0 : repsOrSeconds,
            seconds: c?.is_timed ? repsOrSeconds : null,
            retroactive: true
          }),
        });
      }
      loadChallenges();
      loadLeaderboard();
      loadHistory();
      await loadModalSets(challengeId);
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadModalSets(challengeId) {
    setLoadingSets(true);
    try {
      const { sets } = await api(`/api/challenges/${challengeId}/sets`);
      setModalSets(sets || []);
    } catch (err) {
      console.error('Failed to load sets:', err);
      setModalSets([]);
    } finally {
      setLoadingSets(false);
    }
  }

  async function deleteSet(challengeId, setId) {
    try {
      await api(`/api/challenges/${challengeId}/sets/${setId}/delete`, { method: 'POST' });
      loadChallenges();
      loadLeaderboard();
      await loadModalSets(challengeId);
    } catch (err) {
      alert(err.message);
    }
  }

  async function endChallenge(challengeId) {
    try {
      const result = await api(`/api/challenges/${challengeId}/end`, { method: 'POST' });
      if (onSaveDay) {
        onSaveDay({ exercise: result.challenge.exercise, totalReps: result.total_reps, setsCompleted: result.sets_count });
      }
      setChallenges(challenges.filter(c => c.id !== challengeId));
      const newTimers = { ...timers };
      delete newTimers[challengeId];
      setTimers(newTimers);
      loadLeaderboard();
      loadHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  async function openModal(challengeId, type) {
    const c = challenges.find(ch => ch.id === challengeId);
    setModalChallengeId(challengeId);
    setModalType(type);
    setActualReps(c?.target_reps || 0);
    setActualSeconds(c?.target_seconds || 60);
    setBulkSets('1');
    setModalSets([]);
    if (type === 'edit') {
      await loadModalSets(challengeId);
    }
  }

  function closeModal() {
    setModalChallengeId(null);
    setModalType(null);
    setActualReps(0);
    setActualSeconds(0);
    setBulkSets('1');
    setModalSets([]);
  }

  const canAddMore = challenges.length < MAX_CHALLENGES;
  const modalChallenge = challenges.find(c => c.id === modalChallengeId);

  // Group leaderboard by user (today only - for quick view)
  const leaderboardByUser = leaderboard.reduce((acc, item) => {
    const key = item.user_id;
    if (!acc[key]) acc[key] = { user_name: item.user_name, user_id: item.user_id, total_reps: 0, challenges: [] };
    acc[key].total_reps += item.total_reps;
    acc[key].challenges.push(item);
    return acc;
  }, {});
  const sortedLeaderboard = Object.values(leaderboardByUser).sort((a, b) => b.total_reps - a.total_reps);

  // Build weekly history grouped by date, then by user
  const historyByDate = (history.dates || []).map(date => {
    const dayName = getDayName(date);
    const dateStr = date.slice(5).replace('-', '/'); // "01/12" format

    // Get all challenges for this date
    const dayChallenges = (history.challenges || []).filter(c => c.date === date);
    // Get all workouts for this date
    const dayWorkouts = (history.workouts || []).filter(w => w.date === date);

    // Group by user
    const byUser = {};
    dayChallenges.forEach(c => {
      if (!byUser[c.user_id]) byUser[c.user_id] = { user_name: c.user_name, user_id: c.user_id, items: [] };
      byUser[c.user_id].items.push({
        type: 'challenge',
        exercise: c.exercise,
        total_reps: c.total_reps,
        total_seconds: c.total_seconds,
        sets_count: c.sets_count,
        is_timed: c.is_timed
      });
    });
    dayWorkouts.forEach(w => {
      if (!byUser[w.user_id]) byUser[w.user_id] = { user_name: w.user_name, user_id: w.user_id, items: [] };
      // Use hiit_program_title for HIIT sessions, otherwise template_title or session_type
      const title = w.hiit_program_title || w.template_title || w.session_type || 'Träning';
      byUser[w.user_id].items.push({ type: 'workout', title, duration_sec: w.duration_sec, session_type: w.session_type });
    });

    const users = Object.values(byUser);
    return { date, dayName, dateStr, users, hasActivity: users.length > 0 };
  });

  return (
    <div className="daily-challenges-wrapper">
      {/* Activity notifications */}
      {activity.length > 0 && (
        <div className="challenge-activity">
          {activity.slice(0, 3).map((a, i) => (
            <div key={a.id || i} className="activity-item">
              <strong>{a.user_name}</strong> gjorde {a.reps} {a.exercise}
            </div>
          ))}
        </div>
      )}

      {/* Full-screen timer overlay */}
      {activeTimer && (
        <div className="timed-challenge-overlay">
          <div className="timed-challenge-content">
            <div className="timed-challenge-exercise">
              {challenges.find(ch => ch.id === activeTimer.challengeId)?.exercise}
            </div>
            {activeTimer.phase === 'countdown' ? (
              <>
                <div className="timed-challenge-label">Gör dig redo!</div>
                <div className="timed-challenge-countdown">{timerDisplay}</div>
              </>
            ) : (
              <>
                <div className="timed-challenge-time">{formatTime(timerDisplay)}</div>
                {activeTimer.targetSeconds > 0 && (
                  <div className="timed-challenge-target">
                    Mål: {formatTime(activeTimer.targetSeconds)}
                  </div>
                )}
              </>
            )}
            <button
              className={`timed-challenge-stop ${activeTimer.phase === 'countdown' ? 'cancel' : ''}`}
              onClick={stopTimedChallenge}
            >
              {activeTimer.phase === 'countdown' ? 'Avbryt' : 'Stopp'}
            </button>
          </div>
        </div>
      )}

      <div className="daily-challenges-container">
        {/* Active challenges */}
        {challenges.map((c) => {
          const cd = countdowns[c.id] || {};
          const isTimedChallenge = c.is_timed === 1;
          return (
            <div key={c.id} className={`daily-challenge-card full-width expanded ${cd.ready ? 'ready' : ''} ${isTimedChallenge ? 'timed' : ''}`}>
              {/* Header row - title and stats on same line */}
              <div className="challenge-card-header">
                <div className="challenge-card-title-row">
                  <strong className="challenge-card-name">{c.exercise}</strong>
                  <div className="challenge-card-stats-inline">
                    {isTimedChallenge ? (
                      <span>{formatTimeStats(c.total_seconds || 0)}</span>
                    ) : (
                      <span>{c.total_reps || 0} reps</span>
                    )}
                    <span className="stats-separator">·</span>
                    <span>{c.sets_count || 0} set</span>
                  </div>
                </div>
                <div className="challenge-card-meta">
                  {isTimedChallenge
                    ? `${formatTimeStats(c.target_seconds)} × var ${c.interval_minutes} min`
                    : `${c.target_reps} × var ${c.interval_minutes} min`
                  }
                </div>
              </div>

              {/* Main action area */}
              <div className="challenge-card-main">
                {cd.ready ? (
                  <>
                    {isTimedChallenge ? (
                      <button className="log-button-large timed" onClick={() => startTimedChallenge(c.id, c.target_seconds || 0)}>
                        <span className="log-button-icon">▶</span>
                        <span className="log-button-text">Starta {c.target_seconds > 0 ? formatTimeStats(c.target_seconds) : ''}</span>
                      </button>
                    ) : (
                      <button className="log-button-large" onClick={() => logSet(c.id, c.target_reps)}>
                        <span className="log-button-icon">✓</span>
                        <span className="log-button-text">{c.target_reps} reps</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="challenge-countdown-display">
                    <span className="countdown-label">Nästa om</span>
                    <span className="countdown-time">
                      {String(cd.minutes || 0).padStart(2, '0')}:{String(cd.seconds || 0).padStart(2, '0')}
                    </span>
                  </div>
                )}
              </div>

              {/* Secondary actions */}
              <div className="challenge-card-footer">
                <button className="ghost small" onClick={() => openModal(c.id, 'edit')}>✏️ Redigera</button>
                {isTimedChallenge ? (
                  <button className="ghost small" onClick={() => openModal(c.id, 'log')}>Manuell logg</button>
                ) : (
                  <button className="ghost small" onClick={() => openModal(c.id, 'log')}>Annat antal</button>
                )}
                <button className="ghost small muted" onClick={() => setConfirmEndId(c.id)}>Avsluta</button>
              </div>
            </div>
          );
        })}

        {/* Add new challenge */}
        {showSetup ? (
          <div className="daily-challenge-card setup full-width">
            <div className="challenge-setup-compact">
              <input value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Övning (t.ex. Armhävningar, Planka)" autoFocus />

              {/* Type toggle */}
              <div className="setup-type-toggle">
                <button
                  className={`type-btn ${!isTimed ? 'active' : ''}`}
                  onClick={() => setIsTimed(false)}
                >
                  Reps
                </button>
                <button
                  className={`type-btn ${isTimed ? 'active' : ''}`}
                  onClick={() => setIsTimed(true)}
                >
                  Tid
                </button>
              </div>

              <div className="setup-row">
                {isTimed ? (
                  <>
                    <select value={targetSeconds} onChange={(e) => setTargetSeconds(Number(e.target.value))} className="time-select">
                      {TIMED_PRESETS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                    <span>var</span>
                  </>
                ) : (
                  <>
                    <input type="number" value={targetReps} onChange={(e) => setTargetReps(Number(e.target.value))} min={1} className="reps-input" />
                    <span>reps var</span>
                  </>
                )}
                <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                  {INTERVAL_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                </select>
              </div>
              <div className="setup-actions">
                <button onClick={addChallenge} disabled={!exercise.trim()}>Starta</button>
                <button className="ghost" onClick={() => { setShowSetup(false); setIsTimed(false); }}>×</button>
              </div>
            </div>
          </div>
        ) : canAddMore ? (
          <button className="add-challenge-btn" onClick={() => setShowSetup(true)}>
            + Utmaning {challenges.length > 0 ? `(${challenges.length}/${MAX_CHALLENGES})` : ''}
          </button>
        ) : null}
      </div>

      {/* Weekly history / leaderboard */}
      {(historyByDate.some(d => d.hasActivity) || sortedLeaderboard.length > 0) && (
        <div className="challenge-leaderboard-section">
          <button className="leaderboard-toggle" onClick={() => setShowLeaderboard(!showLeaderboard)}>
            🏆 Veckans träning {showLeaderboard ? '▲' : '▼'}
          </button>
          {showLeaderboard && historyByDate.some(d => d.hasActivity) && (
            <div className="challenge-history">
              {historyByDate.filter(d => d.hasActivity).map(day => (
                <div key={day.date} className="history-day">
                  <div className="history-day-header">
                    <span className="day-name">{day.dayName}</span>
                    <span className="day-date">{day.dateStr}</span>
                  </div>
                  <div className="history-day-users">
                    {day.users
                      .filter(user => user.items.some(item => item.type !== 'challenge' || item.total_reps > 0))
                      .map(user => (
                      <div key={user.user_id} className={`history-user ${user.user_id === currentUserId ? 'me' : ''}`}>
                        <span className="history-user-name">{user.user_name}</span>
                        <div className="history-user-items">
                          {user.items
                            .filter(item => item.type !== 'challenge' || item.total_reps > 0 || item.total_seconds > 0)
                            .map((item, idx) => (
                            <div key={idx} className={`history-item ${item.type}`}>
                              {item.type === 'challenge' ? (
                                <>
                                  <span className="item-name">{item.exercise}:</span>
                                  <span className="item-value">
                                    {item.is_timed
                                      ? `${formatTimeStats(item.total_seconds)} (${item.sets_count} set)`
                                      : `${item.total_reps} reps (${item.sets_count} set)`
                                    }
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="item-name">{item.title}:</span>
                                  <span className="item-value">{formatDuration(item.duration_sec)}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Fallback to old leaderboard if history is empty */}
          {showLeaderboard && !historyByDate.some(d => d.hasActivity) && sortedLeaderboard.length > 0 && (
            <div className="challenge-leaderboard">
              {sortedLeaderboard.map((entry, i) => (
                <div key={entry.user_id} className={`leaderboard-entry ${entry.user_id === currentUserId ? 'me' : ''}`}>
                  <span className="lb-rank">{i + 1}</span>
                  <span className="lb-name">{entry.user_name}</span>
                  <span className="lb-reps">{entry.total_reps} reps</span>
                  <span className="lb-exercises">{entry.challenges.map(c => c.exercise).join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modalChallenge && (
        <div className="challenge-modal-overlay" onClick={closeModal}>
          <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
            <h4>{modalChallenge.exercise}</h4>
            {modalType === 'log' && (
              <>
                {modalChallenge.is_timed === 1 ? (
                  <>
                    <label className="setup-field"><span>Tid (sekunder)</span>
                      <input type="number" value={actualSeconds} onChange={(e) => setActualSeconds(Number(e.target.value))} min={0} autoFocus />
                    </label>
                    <div className="modal-actions">
                      <button onClick={() => logSet(modalChallengeId, 0, actualSeconds)}>Spara</button>
                      <button className="ghost" onClick={closeModal}>Avbryt</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="setup-field"><span>Antal reps</span>
                      <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} autoFocus />
                    </label>
                    <div className="modal-actions">
                      <button onClick={() => logSet(modalChallengeId, actualReps)}>Spara</button>
                      <button className="ghost" onClick={closeModal}>Avbryt</button>
                    </div>
                  </>
                )}
              </>
            )}
            {modalType === 'edit' && (
              <>
                {/* Set log */}
                <div className="sets-log">
                  <p className="modal-hint">Dagens logg ({modalSets.length} set)</p>
                  {loadingSets ? (
                    <p className="muted">Laddar...</p>
                  ) : modalSets.length === 0 ? (
                    <p className="muted">Inga set loggade än</p>
                  ) : (
                    <div className="sets-list">
                      {modalSets.map((s, idx) => {
                        const time = s.logged_at ? new Date(s.logged_at + 'Z').toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '—';
                        return (
                          <div key={s.id} className="set-row">
                            <span className="set-num">#{idx + 1}</span>
                            <span className="set-time">{time}</span>
                            <span className="set-reps">
                              {modalChallenge.is_timed === 1
                                ? formatTimeStats(s.seconds || 0)
                                : `${s.reps} reps`
                              }
                            </span>
                            <button className="set-delete" onClick={() => deleteSet(modalChallengeId, s.id)} title="Ta bort">×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <hr className="modal-divider" />

                {/* Add sets */}
                <p className="modal-hint">Lägg till set</p>
                <label className="setup-field"><span>Antal set</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={bulkSets} onChange={(e) => setBulkSets(e.target.value)} autoFocus />
                </label>
                {modalChallenge.is_timed === 1 ? (
                  <label className="setup-field"><span>Sekunder per set</span>
                    <input type="number" value={actualSeconds} onChange={(e) => setActualSeconds(Number(e.target.value))} min={0} />
                  </label>
                ) : (
                  <label className="setup-field"><span>Reps per set</span>
                    <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} />
                  </label>
                )}
                <div className="modal-actions">
                  <button onClick={() => addBulkSets(modalChallengeId, bulkSets, modalChallenge.is_timed === 1 ? actualSeconds : actualReps)}>
                    Lägg till {parseInt(bulkSets, 10) || 0} set
                  </button>
                  <button className="ghost" onClick={closeModal}>Stäng</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* End challenge confirmation modal */}
      {confirmEndId && (
        <div className="challenge-modal-overlay" onClick={() => setConfirmEndId(null)}>
          <div className="challenge-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Avsluta utmaning?</h4>
            <p className="confirm-text">
              Är du säker på att du vill avsluta <strong>{challenges.find(c => c.id === confirmEndId)?.exercise}</strong> för idag?
            </p>
            <p className="confirm-hint">
              💡 Om du inte avslutar manuellt fortsätter utmaningen automatiskt till midnatt, sen startar den om imorgon.
            </p>
            <div className="modal-actions">
              <button className="danger" onClick={() => { endChallenge(confirmEndId); setConfirmEndId(null); }}>
                Ja, avsluta
              </button>
              <button className="ghost" onClick={() => setConfirmEndId(null)}>Avbryt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DailyChallenge;
