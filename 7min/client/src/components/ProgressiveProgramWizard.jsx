import { useMemo, useState } from 'react';

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Något gick fel');
  return data;
}

const EXERCISES = [
  { key: 'burpees', label: 'Burpees' },
  { key: 'pushups', label: 'Push-ups' },
  { key: 'pullups', label: 'Pull-ups' },
];

const METHODS = [
  { key: 'submax', label: 'Submax', help: '5 set på ~70% av max. Adaptiv volym.' },
  { key: 'ladder', label: 'Ladder', help: 'Trappa 1–2–3–…–top, ingen failure.' },
];

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ProgressiveProgramWizard({ onCreated, onCancel }) {
  const [exerciseKey, setExerciseKey] = useState('burpees');
  const [testMax, setTestMax] = useState(12);
  const [method, setMethod] = useState('submax');
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [preferredDays, setPreferredDays] = useState(['Mon', 'Wed', 'Fri']);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => {
    const max = Number(testMax);
    return (
      !!exerciseKey &&
      !!method &&
      Number.isFinite(max) &&
      max >= 1 &&
      (daysPerWeek === 3 || daysPerWeek === 4) &&
      preferredDays.length === daysPerWeek
    );
  }, [exerciseKey, method, testMax, daysPerWeek, preferredDays]);

  function toggleDay(day) {
    setPreferredDays((prev) => {
      const has = prev.includes(day);
      if (has) return prev.filter((d) => d !== day);
      if (prev.length >= daysPerWeek) return prev;
      return [...prev, day];
    });
  }

  function onChangeDaysPerWeek(value) {
    const n = Number(value) === 4 ? 4 : 3;
    setDaysPerWeek(n);
    setPreferredDays((prev) => prev.slice(0, n));
  }

  async function handleCreate() {
    setStatus('');
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        exercise_key: exerciseKey,
        method,
        test_max: Number(testMax),
        days_per_week: daysPerWeek,
        preferred_days: preferredDays,
      };
      const data = await api('/api/progressive-programs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onCreated?.(data.program);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Progressivt</p>
          <h2>Skapa program</h2>
        </div>
        <button className="ghost" type="button" onClick={onCancel} disabled={saving}>
          Avbryt
        </button>
      </div>

      {status && <div className="status">{status}</div>}

      <div className="form-grid">
        <label>
          Övning
          <select value={exerciseKey} onChange={(e) => setExerciseKey(e.target.value)} disabled={saving}>
            {EXERCISES.map((ex) => (
              <option key={ex.key} value={ex.key}>
                {ex.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Max (reps)
          <input
            type="number"
            min={1}
            value={testMax}
            onChange={(e) => setTestMax(e.target.value)}
            disabled={saving}
          />
        </label>

        <label>
          Metod
          <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={saving}>
            {METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="helper-text">{METHODS.find((m) => m.key === method)?.help}</div>
        </label>

        <label>
          Dagar/vecka
          <select value={daysPerWeek} onChange={(e) => onChangeDaysPerWeek(e.target.value)} disabled={saving}>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
      </div>

      <div className="days-picker">
        <div className="days-header">
          <div>
            <p className="eyebrow">Schema</p>
            <h3>Välj {daysPerWeek} dagar</h3>
          </div>
          <span className="badge">{preferredDays.length}/{daysPerWeek}</span>
        </div>
        <div className="days-buttons">
          {DAY_ORDER.map((day) => {
            const active = preferredDays.includes(day);
            const disabled = saving || (!active && preferredDays.length >= daysPerWeek);
            return (
              <button
                key={day}
                type="button"
                className={`day-btn ${active ? 'active' : ''}`}
                onClick={() => toggleDay(day)}
                disabled={disabled}
              >
                {day}
              </button>
            );
          })}
        </div>
        <div className="helper-text">
          Tips: välj jämnt spritt (t.ex. Mon/Wed/Fri).
        </div>
      </div>

      <div className="actions-row">
        <button type="button" onClick={handleCreate} disabled={!canSubmit || saving}>
          {saving ? 'Skapar…' : 'Skapa program'}
        </button>
      </div>
    </div>
  );
}

export default ProgressiveProgramWizard;

