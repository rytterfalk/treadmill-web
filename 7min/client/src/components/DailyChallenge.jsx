import { useState, useEffect, useRef } from 'react';

const INTERVAL_OPTIONS = [
  { value: 15, label: 'Var 15:e minut' },
  { value: 30, label: 'Var 30:e minut' },
  { value: 45, label: 'Var 45:e minut' },
  { value: 60, label: 'Varje timme' },
  { value: 90, label: 'Var 1,5 timme' },
  { value: 120, label: 'Varannan timme' },
];

function DailyChallenge({ onSaveDay }) {
  // Load from localStorage
  const [challenge, setChallenge] = useState(() => {
    try {
      const saved = localStorage.getItem('7min_daily_challenge');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check if it's still today
        const today = new Date().toISOString().slice(0, 10);
        if (parsed.date === today) return parsed;
      }
    } catch {}
    return null;
  });

  const [showSetup, setShowSetup] = useState(false);
  const [exercise, setExercise] = useState('Armhävningar');
  const [targetReps, setTargetReps] = useState(30);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [countdown, setCountdown] = useState(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [actualReps, setActualReps] = useState(0);
  const [bulkSets, setBulkSets] = useState(0);
  const intervalRef = useRef(null);

  // Save to localStorage whenever challenge changes
  useEffect(() => {
    if (challenge) {
      localStorage.setItem('7min_daily_challenge', JSON.stringify(challenge));
    }
  }, [challenge]);

  // Countdown timer
  useEffect(() => {
    if (!challenge || challenge.ended) {
      setCountdown(null);
      return;
    }

    function updateCountdown() {
      const now = Date.now();
      const nextSet = challenge.nextSetTime;
      const diff = nextSet - now;

      if (diff <= 0) {
        setCountdown({ minutes: 0, seconds: 0, ready: true });
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setCountdown({ minutes: mins, seconds: secs, ready: false });
      }
    }

    updateCountdown();
    intervalRef.current = setInterval(updateCountdown, 1000);
    return () => clearInterval(intervalRef.current);
  }, [challenge]);

  function startChallenge() {
    const now = Date.now();
    const newChallenge = {
      date: new Date().toISOString().slice(0, 10),
      exercise,
      targetReps,
      intervalMinutes,
      sets: [],
      startedAt: now,
      nextSetTime: now, // First set is now!
      ended: false,
    };
    setChallenge(newChallenge);
    setShowSetup(false);
  }

  function logSet(reps) {
    if (!challenge) return;
    const now = Date.now();
    const newSets = [...challenge.sets, { reps, time: now }];
    const nextSetTime = now + challenge.intervalMinutes * 60 * 1000;
    setChallenge({ ...challenge, sets: newSets, nextSetTime });
    setShowLogModal(false);
    setActualReps(0);
  }

  function addBulkSets(numSets, repsPerSet) {
    if (!challenge || numSets <= 0) return;
    const now = Date.now();
    const newSets = [...challenge.sets];
    // Add sets with times spread backwards based on interval
    for (let i = numSets - 1; i >= 0; i--) {
      const setTime = now - (i * challenge.intervalMinutes * 60 * 1000);
      newSets.push({ reps: repsPerSet, time: setTime, retroactive: true });
    }
    // Sort by time
    newSets.sort((a, b) => a.time - b.time);
    // Set next set time to one interval from now
    const nextSetTime = now + challenge.intervalMinutes * 60 * 1000;
    setChallenge({ ...challenge, sets: newSets, nextSetTime });
    setShowEditModal(false);
    setBulkSets(0);
  }

  function endDay() {
    if (!challenge) return;
    const totalReps = challenge.sets.reduce((sum, s) => sum + s.reps, 0);
    const summary = {
      date: challenge.date,
      exercise: challenge.exercise,
      totalReps,
      setsCompleted: challenge.sets.length,
      targetPerSet: challenge.targetReps,
      sets: challenge.sets,
    };
    // Call parent to save to weekly progress
    if (onSaveDay) onSaveDay(summary);
    // Mark as ended
    setChallenge({ ...challenge, ended: true });
    localStorage.removeItem('7min_daily_challenge');
  }

  function resetChallenge() {
    setChallenge(null);
    localStorage.removeItem('7min_daily_challenge');
  }

  const totalReps = challenge?.sets?.reduce((sum, s) => sum + s.reps, 0) || 0;
  const setsCompleted = challenge?.sets?.length || 0;

  // No active challenge - show start button
  if (!challenge || challenge.ended) {
    return (
      <div className="daily-challenge-panel">
        <div className="challenge-header">
          <span className="challenge-icon">🔄</span>
          <h3>Daglig utmaning</h3>
        </div>
        {showSetup ? (
          <div className="challenge-setup">
            <label className="setup-field">
              <span>Övning</span>
              <input value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="T.ex. Armhävningar" />
            </label>
            <label className="setup-field">
              <span>Reps per set</span>
              <input type="number" value={targetReps} onChange={(e) => setTargetReps(Number(e.target.value))} min={1} />
            </label>
            <label className="setup-field">
              <span>Intervall</span>
              <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <div className="setup-actions">
              <button onClick={startChallenge}>Starta utmaning</button>
              <button className="ghost" onClick={() => setShowSetup(false)}>Avbryt</button>
            </div>
          </div>
        ) : (
          <div className="challenge-empty">
            <p>Träna en övning med jämna intervall under dagen</p>
            <button onClick={() => setShowSetup(true)}>Starta daglig utmaning</button>
          </div>
        )}
      </div>
    );
  }

  // Active challenge UI
  return (
    <div className="daily-challenge-panel active">
      <div className="challenge-header">
        <span className="challenge-icon">🔄</span>
        <div>
          <h3>{challenge.exercise}</h3>
          <span className="challenge-subtitle">{challenge.targetReps} reps var {challenge.intervalMinutes}:e minut</span>
        </div>
      </div>

      {/* Timer */}
      <div className="challenge-timer">
        {countdown?.ready ? (
          <div className="timer-ready">
            <span className="ready-text">Dags för nästa set!</span>
            <span className="target-reps">{challenge.targetReps} {challenge.exercise}</span>
          </div>
        ) : (
          <div className="timer-countdown">
            <span className="countdown-label">Nästa set om</span>
            <span className="countdown-time">
              {String(countdown?.minutes || 0).padStart(2, '0')}:{String(countdown?.seconds || 0).padStart(2, '0')}
            </span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="challenge-stats">
        <div className="stat">
          <span className="stat-value">{totalReps}</span>
          <span className="stat-label">totalt reps</span>
        </div>
        <div className="stat">
          <span className="stat-value">{setsCompleted}</span>
          <span className="stat-label">set klara</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="challenge-actions">
        {countdown?.ready ? (
          <>
            <button className="log-full" onClick={() => logSet(challenge.targetReps)}>
              ✓ Klart! ({challenge.targetReps} reps)
            </button>
            <button className="ghost" onClick={() => { setActualReps(challenge.targetReps); setShowLogModal(true); }}>
              Annat antal...
            </button>
          </>
        ) : (
          <button className="ghost" onClick={() => { setActualReps(challenge.targetReps); setShowLogModal(true); }}>
            Logga extra set
          </button>
        )}
      </div>

      <div className="challenge-end-section">
        <button className="ghost small" onClick={() => { setBulkSets(1); setShowEditModal(true); }}>✏️ Lägg till tidigare set</button>
        <button className="ghost small danger" onClick={endDay}>Avsluta för dagen</button>
      </div>

      {/* Log modal */}
      {showLogModal && (
        <div className="challenge-modal-overlay" onClick={() => setShowLogModal(false)}>
          <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Logga set</h4>
            <label className="setup-field">
              <span>Antal reps</span>
              <input type="number" value={actualReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} autoFocus />
            </label>
            <div className="modal-actions">
              <button onClick={() => logSet(actualReps)}>Spara</button>
              <button className="ghost" onClick={() => setShowLogModal(false)}>Avbryt</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk add modal */}
      {showEditModal && (
        <div className="challenge-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Lägg till tidigare set</h4>
            <p className="modal-hint">Lägg till set du redan gjort idag</p>
            <label className="setup-field">
              <span>Antal set att lägga till</span>
              <input type="number" value={bulkSets} onChange={(e) => setBulkSets(Number(e.target.value))} min={1} max={20} autoFocus />
            </label>
            <label className="setup-field">
              <span>Reps per set</span>
              <input type="number" value={actualReps || challenge.targetReps} onChange={(e) => setActualReps(Number(e.target.value))} min={0} />
            </label>
            <div className="modal-actions">
              <button onClick={() => addBulkSets(bulkSets, actualReps || challenge.targetReps)}>
                Lägg till {bulkSets} set ({bulkSets * (actualReps || challenge.targetReps)} reps)
              </button>
              <button className="ghost" onClick={() => setShowEditModal(false)}>Avbryt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DailyChallenge;
