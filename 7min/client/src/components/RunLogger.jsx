import { useState } from 'react';

const RUN_TYPES = [
  { value: 'outdoor', label: '🌳 Utomhus', emoji: '🌳' },
  { value: 'treadmill', label: '🏃 Löpband', emoji: '🏃' },
  { value: 'track', label: '🏟️ Bana', emoji: '🏟️' },
];

const WORKOUT_TYPES = [
  { value: 'easy', label: 'Lugnt pass' },
  { value: 'zone2', label: 'Zone 2 (aerob)' },
  { value: 'intervals', label: 'Intervaller' },
  { value: 'tempo', label: 'Tempopass' },
  { value: 'long', label: 'Långpass' },
  { value: 'race', label: 'Tävling' },
];

function RunLogger({ onLogRun }) {
  const [expanded, setExpanded] = useState(false);
  const [distance, setDistance] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [notes, setNotes] = useState('');
  const [runType, setRunType] = useState('outdoor');
  const [workoutType, setWorkoutType] = useState('easy');
  const [saving, setSaving] = useState(false);

  const distanceNum = parseFloat(distance) || 0;
  const durationSec = (parseInt(minutes, 10) || 0) * 60 + (parseInt(seconds, 10) || 0);

  // Calculate pace (min/km)
  const paceMinPerKm = distanceNum > 0 && durationSec > 0
    ? durationSec / 60 / distanceNum
    : 0;
  const paceMin = Math.floor(paceMinPerKm);
  const paceSec = Math.round((paceMinPerKm - paceMin) * 60);
  const paceStr = paceMinPerKm > 0 ? `${paceMin}:${String(paceSec).padStart(2, '0')}` : '--:--';

  async function handleSave() {
    if (!distanceNum || !durationSec) return;
    setSaving(true);
    try {
      await onLogRun({
        distance_km: distanceNum,
        duration_sec: durationSec,
        notes: notes || '',
        run_type: runType,
        workout_type: workoutType,
      });
      // Reset form
      setDistance('');
      setMinutes('');
      setSeconds('');
      setNotes('');
      setRunType('outdoor');
      setWorkoutType('easy');
      setExpanded(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <section className="panel run-logger-panel">
        <div className="panel-header clickable" onClick={() => setExpanded(true)}>
          <div>
            <p className="eyebrow">Manuell logg</p>
            <h2>🏃 Logga löpning</h2>
          </div>
          <span className="badge">+</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel run-logger-panel expanded">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Manuell logg</p>
          <h2>🏃 Logga löpning</h2>
        </div>
        <button className="ghost" onClick={() => setExpanded(false)}>✕</button>
      </div>

      <div className="run-logger-form">
        <label className="setup-field">
          <span>Distans (km)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="5.0"
            autoFocus
          />
        </label>

        <div className="time-inputs">
          <label className="setup-field">
            <span>Tid (min)</span>
            <input
              type="number"
              min="0"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="30"
            />
          </label>
          <label className="setup-field">
            <span>Sek</span>
            <input
              type="number"
              min="0"
              max="59"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              placeholder="00"
            />
          </label>
        </div>

        {distanceNum > 0 && durationSec > 0 && (
          <div className="pace-display">
            <span className="pace-label">Tempo:</span>
            <span className="pace-value">{paceStr} min/km</span>
          </div>
        )}

        <div className="run-type-selector">
          <span className="field-label">Var?</span>
          <div className="toggle-buttons">
            {RUN_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                className={`toggle-btn ${runType === t.value ? 'active' : ''}`}
                onClick={() => setRunType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="workout-type-selector">
          <span className="field-label">Typ av pass</span>
          <div className="toggle-buttons wrap">
            {WORKOUT_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                className={`toggle-btn ${workoutType === t.value ? 'active' : ''}`}
                onClick={() => setWorkoutType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <label className="setup-field">
          <span>Anteckningar (valfritt)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Morgonlöpning..."
          />
        </label>

        <div className="modal-actions">
          <button onClick={handleSave} disabled={saving || !distanceNum || !durationSec}>
            {saving ? 'Sparar...' : 'Spara löppass'}
          </button>
          <button className="ghost" onClick={() => setExpanded(false)}>Avbryt</button>
        </div>
      </div>
    </section>
  );
}

export default RunLogger;

