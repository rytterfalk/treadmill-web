import { useState, useEffect, useRef } from 'react';

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 tim' },
];

const MAX_CHALLENGES = 3;
const STORAGE_KEY = '7min_daily_challenges';

// Calculate next aligned clock time (e.g., :00, :30 for 30min intervals)
function getNextAlignedTime(intervalMins, afterTime = Date.now()) {
  const d = new Date(afterTime);
  const mins = d.getMinutes();
  const alignedMinute = Math.ceil(mins / intervalMins) * intervalMins;
  d.setMinutes(alignedMinute, 0, 0);
  if (d.getTime() <= afterTime) {
    d.setMinutes(d.getMinutes() + intervalMins);
  }
  return d.getTime();
}

function DailyChallenge({ onSaveDay }) {
  // Load challenges array from localStorage
  const [challenges, setChallenges] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const today = new Date().toISOString().slice(0, 10);
        // Filter to only today's challenges that aren't ended
        return parsed.filter(c => c.date === today && !c.ended);
      }
    } catch {}
    return [];
  });

  const [showSetup, setShowSetup] = useState(false);
  const [exercise, setExercise] = useState('');
  const [targetReps, setTargetReps] = useState(30);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [countdowns, setCountdowns] = useState({});

  // Modal state - which challenge index is being edited
  const [modalChallengeIdx, setModalChallengeIdx] = useState(null);
  const [modalType, setModalType] = useState(null); // 'log' | 'edit'
  const [actualReps, setActualReps] = useState(0);
  const [bulkSets, setBulkSets] = useState(1);

  // Save to localStorage whenever challenges change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(challenges));
  }, [challenges]);

  // Countdown timers for all challenges
  useEffect(() => {
    if (challenges.length === 0) {
      setCountdowns({});
      return;
    }

    function updateCountdowns() {
      const now = Date.now();
      const newCountdowns = {};
      challenges.forEach((c, idx) => {
        const diff = c.nextSetTime - now;
        if (diff <= 0) {
          newCountdowns[idx] = { minutes: 0, seconds: 0, ready: true };
        } else {
          newCountdowns[idx] = {
            minutes: Math.floor(diff / 60000),
            seconds: Math.floor((diff % 60000) / 1000),
            ready: false,
          };
        }
      });
      setCountdowns(newCountdowns);
    }

    updateCountdowns();
    const interval = setInterval(updateCountdowns, 1000);
    return () => clearInterval(interval);
  }, [challenges]);

  function addChallenge() {
    if (challenges.length >= MAX_CHALLENGES) return;
    const now = Date.now();
    const newChallenge = {
      id: Date.now(),
      date: new Date().toISOString().slice(0, 10),
      exercise,
      targetReps,
      intervalMinutes,
      sets: [],
      startedAt: now,
      nextSetTime: now,
      ended: false,
    };
    setChallenges([...challenges, newChallenge]);
    setShowSetup(false);
    setExercise('');
  }

  function updateChallenge(idx, updates) {
    setChallenges(challenges.map((c, i) => i === idx ? { ...c, ...updates } : c));
  }

  function logSet(idx, reps) {
    const c = challenges[idx];
    if (!c) return;
    const now = Date.now();
    const newSets = [...c.sets, { reps, time: now }];
    const nextSetTime = getNextAlignedTime(c.intervalMinutes, now);
    updateChallenge(idx, { sets: newSets, nextSetTime });
    closeModal();
  }

  function addBulkSets(idx, numSets, repsPerSet) {
    const c = challenges[idx];
    if (!c || numSets <= 0) return;
    const now = Date.now();
    const newSets = [...c.sets];
    for (let i = numSets - 1; i >= 0; i--) {
      const setTime = now - (i * c.intervalMinutes * 60 * 1000);
      newSets.push({ reps: repsPerSet, time: setTime, retroactive: true });
    }
    newSets.sort((a, b) => a.time - b.time);
    const nextSetTime = c.nextSetTime > now ? c.nextSetTime : getNextAlignedTime(c.intervalMinutes, now);
    updateChallenge(idx, { sets: newSets, nextSetTime });
    closeModal();
  }

  function endChallenge(idx) {
    const c = challenges[idx];
    if (!c) return;
    const totalReps = c.sets.reduce((sum, s) => sum + s.reps, 0);
    if (onSaveDay) {
      onSaveDay({
        date: c.date,
        exercise: c.exercise,
        totalReps,
        setsCompleted: c.sets.length,
        targetPerSet: c.targetReps,
        sets: c.sets,
      });
    }
    setChallenges(challenges.filter((_, i) => i !== idx));
  }

  function openModal(idx, type) {
    setModalChallengeIdx(idx);
    setModalType(type);
    setActualReps(challenges[idx]?.targetReps || 0);
    setBulkSets(1);
  }

  function closeModal() {
    setModalChallengeIdx(null);
    setModalType(null);
    setActualReps(0);
    setBulkSets(1);
  }

  const canAddMore = challenges.length < MAX_CHALLENGES;
  const modalChallenge = modalChallengeIdx !== null ? challenges[modalChallengeIdx] : null;

  return (
    <div className="daily-challenges-container">
      {/* Active challenges */}
      {challenges.map((c, idx) => {
        const cd = countdowns[idx] || {};
        const totalReps = c.sets.reduce((sum, s) => sum + s.reps, 0);
        const setsCount = c.sets.length;

        return (
          <div key={c.id} className={`daily-challenge-card ${cd.ready ? 'ready' : ''}`}>
            <div className="challenge-card-header">
              <div className="challenge-card-title">
                <strong>{c.exercise}</strong>
                <span className="challenge-card-meta">{c.targetReps}×{c.intervalMinutes}min</span>
              </div>
              <button className="challenge-edit-btn" onClick={() => openModal(idx, 'edit')} title="Lägg till set">✏️</button>
            </div>

            <div className="challenge-card-body">
              {cd.ready ? (
                <div className="challenge-card-ready">
                  <span className="ready-badge">NU!</span>
                  <button className="log-quick" onClick={() => logSet(idx, c.targetReps)}>✓ {c.targetReps}</button>
                </div>
              ) : (
                <div className="challenge-card-timer">
                  {String(cd.minutes || 0).padStart(2, '0')}:{String(cd.seconds || 0).padStart(2, '0')}
                </div>
              )}
              <div className="challenge-card-stats">
                <span>{totalReps} reps</span>
                <span>{setsCount} set</span>
              </div>
            </div>

            <div className="challenge-card-actions">
              {!cd.ready && (
                <button className="ghost small" onClick={() => openModal(idx, 'log')}>Logga</button>
              )}
              {cd.ready && (
                <button className="ghost small" onClick={() => openModal(idx, 'log')}>Annat...</button>
              )}
              <button className="ghost small danger" onClick={() => endChallenge(idx)}>Avsluta</button>
            </div>
          </div>
        );
      })}

      {/* Add new challenge */}
      {showSetup ? (
        <div className="daily-challenge-card setup">
          <div className="challenge-setup-compact">
            <input
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
              placeholder="Övning (t.ex. Armhävningar)"
              autoFocus
            />
            <div className="setup-row">
              <input
                type="number"
                value={targetReps}
                onChange={(e) => setTargetReps(Number(e.target.value))}
                min={1}
                className="reps-input"
              />
              <span>reps var</span>
              <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
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
          + Lägg till utmaning {challenges.length > 0 ? `(${challenges.length}/${MAX_CHALLENGES})` : ''}
        </button>
      ) : null}

      {/* Modal for logging/editing */}
      {modalChallenge && (
        <div className="challenge-modal-overlay" onClick={closeModal}>
          <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
            <h4>{modalChallenge.exercise}</h4>
            {modalType === 'log' && (
              <>
                <label className="setup-field">
                  <span>Antal reps</span>
                  <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} autoFocus />
                </label>
                <div className="modal-actions">
                  <button onClick={() => logSet(modalChallengeIdx, actualReps)}>Spara</button>
                  <button className="ghost" onClick={closeModal}>Avbryt</button>
                </div>
              </>
            )}
            {modalType === 'edit' && (
              <>
                <p className="modal-hint">Lägg till tidigare set</p>
                <label className="setup-field">
                  <span>Antal set</span>
                  <input type="number" value={bulkSets} onChange={(e) => setBulkSets(Number(e.target.value))} min={1} max={20} autoFocus />
                </label>
                <label className="setup-field">
                  <span>Reps per set</span>
                  <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} />
                </label>
                <div className="modal-actions">
                  <button onClick={() => addBulkSets(modalChallengeIdx, bulkSets, actualReps)}>
                    Lägg till {bulkSets} set
                  </button>
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
