import { useState, useEffect, useCallback } from 'react';

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 tim' },
];

const MAX_CHALLENGES = 3;
const TIMER_STORAGE_KEY = '7min_challenge_timers'; // Local timers only

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

  // Load challenges from backend
  const loadChallenges = useCallback(async () => {
    try {
      const { challenges: data } = await api('/api/challenges/my');
      setChallenges(data || []);
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

  async function addChallenge() {
    if (challenges.length >= MAX_CHALLENGES || !exercise.trim()) return;
    try {
      const { challenge } = await api('/api/challenges', {
        method: 'POST',
        body: JSON.stringify({ exercise, targetReps, intervalMinutes }),
      });
      setChallenges([...challenges, challenge]);
      setTimers({ ...timers, [challenge.id]: Date.now() }); // First set is now
      setShowSetup(false);
      setExercise('');
      loadLeaderboard();
    } catch (err) {
      alert(err.message);
    }
  }

  async function logSet(challengeId, reps) {
    const c = challenges.find(ch => ch.id === challengeId);
    if (!c) return;
    try {
      const result = await api(`/api/challenges/${challengeId}/sets`, {
        method: 'POST',
        body: JSON.stringify({ reps }),
      });
      setChallenges(challenges.map(ch =>
        ch.id === challengeId ? { ...ch, sets_count: result.sets_count, total_reps: result.total_reps } : ch
      ));
      setTimers({ ...timers, [challengeId]: getNextAlignedTime(c.interval_minutes, Date.now()) });
      closeModal();
      loadLeaderboard();
      loadHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  async function addBulkSets(challengeId, numSets, repsPerSet) {
    const n = parseInt(numSets, 10) || 0;
    if (n <= 0) return;
    try {
      for (let i = 0; i < n; i++) {
        await api(`/api/challenges/${challengeId}/sets`, {
          method: 'POST',
          body: JSON.stringify({ reps: repsPerSet, retroactive: true }),
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
      byUser[c.user_id].items.push({ type: 'challenge', exercise: c.exercise, total_reps: c.total_reps, sets_count: c.sets_count });
    });
    dayWorkouts.forEach(w => {
      if (!byUser[w.user_id]) byUser[w.user_id] = { user_name: w.user_name, user_id: w.user_id, items: [] };
      const title = w.template_title || w.session_type || 'Träning';
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

      <div className="daily-challenges-container">
        {/* Active challenges */}
        {challenges.map((c) => {
          const cd = countdowns[c.id] || {};
          return (
            <div key={c.id} className={`daily-challenge-card ${cd.ready ? 'ready' : ''}`}>
              <div className="challenge-card-header">
                <div className="challenge-card-title">
                  <strong>{c.exercise}</strong>
                  <span className="challenge-card-meta">{c.target_reps}×{c.interval_minutes}min</span>
                </div>
                <button className="challenge-edit-btn" onClick={() => openModal(c.id, 'edit')} title="Lägg till set">✏️</button>
              </div>
              <div className="challenge-card-body">
                {cd.ready ? (
                  <div className="challenge-card-ready">
                    <span className="ready-badge">NU!</span>
                    <button className="log-quick" onClick={() => logSet(c.id, c.target_reps)}>✓ {c.target_reps}</button>
                  </div>
                ) : (
                  <div className="challenge-card-timer">
                    {String(cd.minutes || 0).padStart(2, '0')}:{String(cd.seconds || 0).padStart(2, '0')}
                  </div>
                )}
                <div className="challenge-card-stats">
                  <span>{c.total_reps || 0} reps</span>
                  <span>{c.sets_count || 0} set</span>
                </div>
              </div>
              <div className="challenge-card-actions">
                {!cd.ready && <button className="ghost small" onClick={() => openModal(c.id, 'log')}>Logga</button>}
                {cd.ready && <button className="ghost small" onClick={() => openModal(c.id, 'log')}>Annat...</button>}
                <button className="ghost small danger" onClick={() => endChallenge(c.id)}>Avsluta</button>
              </div>
            </div>
          );
        })}

        {/* Add new challenge */}
        {showSetup ? (
          <div className="daily-challenge-card setup">
            <div className="challenge-setup-compact">
              <input value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Övning (t.ex. Armhävningar)" autoFocus />
              <div className="setup-row">
                <input type="number" value={targetReps} onChange={(e) => setTargetReps(Number(e.target.value))} min={1} className="reps-input" />
                <span>reps var</span>
                <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                  {INTERVAL_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                </select>
              </div>
              <div className="setup-actions">
                <button onClick={addChallenge} disabled={!exercise.trim()}>Starta</button>
                <button className="ghost" onClick={() => setShowSetup(false)}>×</button>
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
                    {day.users.map(user => (
                      <div key={user.user_id} className={`history-user ${user.user_id === currentUserId ? 'me' : ''}`}>
                        <span className="history-user-name">{user.user_name}</span>
                        <div className="history-user-items">
                          {user.items.map((item, idx) => (
                            <span key={idx} className={`history-item ${item.type}`}>
                              {item.type === 'challenge'
                                ? `${item.exercise}: ${item.total_reps} reps (${item.sets_count} set)`
                                : `${item.title} ${formatDuration(item.duration_sec)}`
                              }
                            </span>
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
                <label className="setup-field"><span>Antal reps</span>
                  <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} autoFocus />
                </label>
                <div className="modal-actions">
                  <button onClick={() => logSet(modalChallengeId, actualReps)}>Spara</button>
                  <button className="ghost" onClick={closeModal}>Avbryt</button>
                </div>
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
                            <span className="set-reps">{s.reps} reps</span>
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
                <label className="setup-field"><span>Reps per set</span>
                  <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} />
                </label>
                <div className="modal-actions">
                  <button onClick={() => addBulkSets(modalChallengeId, bulkSets, actualReps)}>Lägg till {parseInt(bulkSets, 10) || 0} set</button>
                  <button className="ghost" onClick={closeModal}>Stäng</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DailyChallenge;
