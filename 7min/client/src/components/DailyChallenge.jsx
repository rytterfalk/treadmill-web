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
  const d = new Date(afterTime);
  const mins = d.getMinutes();
  const alignedMinute = Math.ceil(mins / intervalMins) * intervalMins;
  d.setMinutes(alignedMinute, 0, 0);
  if (d.getTime() <= afterTime) d.setMinutes(d.getMinutes() + intervalMins);
  return d.getTime();
}

function DailyChallenge({ onSaveDay, currentUserId }) {
  const [challenges, setChallenges] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
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
  const [bulkSets, setBulkSets] = useState(1);
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
  }, [loadChallenges, loadLeaderboard]);

  // Poll for activity every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      checkActivity();
      loadLeaderboard();
    }, 30000);
    return () => clearInterval(interval);
  }, [checkActivity, loadLeaderboard]);

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
    } catch (err) {
      alert(err.message);
    }
  }

  async function addBulkSets(challengeId, numSets, repsPerSet) {
    if (numSets <= 0) return;
    try {
      for (let i = 0; i < numSets; i++) {
        await api(`/api/challenges/${challengeId}/sets`, {
          method: 'POST',
          body: JSON.stringify({ reps: repsPerSet, retroactive: true }),
        });
      }
      loadChallenges();
      loadLeaderboard();
      closeModal();
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
    } catch (err) {
      alert(err.message);
    }
  }

  function openModal(challengeId, type) {
    const c = challenges.find(ch => ch.id === challengeId);
    setModalChallengeId(challengeId);
    setModalType(type);
    setActualReps(c?.target_reps || 0);
    setBulkSets(1);
  }

  function closeModal() {
    setModalChallengeId(null);
    setModalType(null);
    setActualReps(0);
    setBulkSets(1);
  }

  const canAddMore = challenges.length < MAX_CHALLENGES;
  const modalChallenge = challenges.find(c => c.id === modalChallengeId);

  // Group leaderboard by user
  const leaderboardByUser = leaderboard.reduce((acc, item) => {
    const key = item.user_id;
    if (!acc[key]) acc[key] = { user_name: item.user_name, user_id: item.user_id, total_reps: 0, challenges: [] };
    acc[key].total_reps += item.total_reps;
    acc[key].challenges.push(item);
    return acc;
  }, {});
  const sortedLeaderboard = Object.values(leaderboardByUser).sort((a, b) => b.total_reps - a.total_reps);

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

      {/* Leaderboard toggle */}
      {sortedLeaderboard.length > 0 && (
        <div className="challenge-leaderboard-section">
          <button className="leaderboard-toggle" onClick={() => setShowLeaderboard(!showLeaderboard)}>
            🏆 Topplista {showLeaderboard ? '▲' : '▼'}
          </button>
          {showLeaderboard && (
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
                <p className="modal-hint">Lägg till tidigare set</p>
                <label className="setup-field"><span>Antal set</span>
                  <input type="number" value={bulkSets} onChange={(e) => setBulkSets(Number(e.target.value))} min={1} max={20} autoFocus />
                </label>
                <label className="setup-field"><span>Reps per set</span>
                  <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} />
                </label>
                <div className="modal-actions">
                  <button onClick={() => addBulkSets(modalChallengeId, bulkSets, actualReps)}>Lägg till {bulkSets} set</button>
                  <button className="ghost" onClick={closeModal}>Avbryt</button>
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
