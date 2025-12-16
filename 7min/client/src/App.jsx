import { useEffect, useMemo, useState } from 'react';
import './index.css';
import './App.css';
import NavBar from './components/NavBar';
import ProgramEditor from './components/ProgramEditor';
import WorkoutTimer from './components/WorkoutTimer';
import EquipmentSelector from './components/EquipmentSelector';
import SessionList from './components/SessionList';
import WeekBars from './components/WeekBars';
import CalendarGrid from './components/CalendarGrid';

const defaultExercises = [
  { title: 'Jumping Jacks', durationSeconds: 30, restSeconds: 5, notes: '' },
  { title: 'Push-ups', durationSeconds: 30, restSeconds: 10, notes: '' },
  { title: 'Planka', durationSeconds: 40, restSeconds: 15, notes: 'Håll höfterna stilla' },
];

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Något gick fel');
  }
  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [allEquipment, setAllEquipment] = useState([]);
  const [userEquipment, setUserEquipment] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [programDetails, setProgramDetails] = useState({});
  const [selectedProgramId, setSelectedProgramId] = useState(null);
  const [view, setView] = useState('dashboard');
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [status, setStatus] = useState('');
  const [recentSessions, setRecentSessions] = useState([]);
  const [calendarDays, setCalendarDays] = useState([]);
  const [weekBarDays, setWeekBarDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [daySessions, setDaySessions] = useState([]);
  const [pointsCap, setPointsCap] = useState(60);
  const [calendarRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 27); // 28 dagar
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  });

  useEffect(() => {
    loadEquipment();
    loadPrograms();
    checkSession();
  }, []);

  useEffect(() => {
    if (user) {
      loadSessions();
    }
  }, [user]);

  useEffect(() => {
    if (user && view === 'calendar') {
      loadCalendar();
      loadWeekBars();
    }
  }, [user, view, calendarRange.from, calendarRange.to]);

  useEffect(() => {
    if (user && view === 'calendar' && selectedDate) {
      loadDaySessions(selectedDate);
    }
  }, [user, view, selectedDate]);

  const selectedProgram = useMemo(
    () =>
      programDetails[selectedProgramId]?.program ||
      programs.find((p) => p.id === selectedProgramId) ||
      null,
    [programDetails, programs, selectedProgramId]
  );

  const selectedExercises = useMemo(() => {
    const detail = programDetails[selectedProgramId];
    if (!detail) return [];
    return detail.exercises.map((ex) => ({
      id: ex.id,
      title: ex.title,
      durationSeconds: ex.duration_seconds,
      restSeconds: ex.rest_seconds,
      notes: ex.notes || '',
      equipmentHint: ex.equipment_hint || '',
      audioAssetId: ex.audio_asset_id || null,
      audioUrl: ex.audio_url || null,
      halfAudioAssetId: ex.half_audio_asset_id || null,
      halfAudioUrl: ex.half_audio_url || null,
    }));
  }, [programDetails, selectedProgramId]);

  const programStats = useMemo(() => {
    const stats = {};
    programs.forEach((p) => {
      const detail = programDetails[p.id];
      if (!detail?.exercises?.length) return;
      const rounds = Number(detail.program?.rounds || p.rounds || 1) || 1;
      const baseSeconds = detail.exercises.reduce((sum, ex) => {
        const dur = Number(ex.duration_seconds) || 0;
        const rest = Number(ex.rest_seconds) || 0;
        return sum + dur + rest;
      }, 0);
      stats[p.id] = {
        totalSeconds: baseSeconds * rounds,
        moments: detail.exercises.length,
      };
    });
    return stats;
  }, [programDetails, programs]);

  const selectedProgramStats = useMemo(() => {
    if (!selectedExercises.length) return { totalSeconds: 0, moments: 0 };
    const rounds = Number(
      selectedProgram?.rounds || programDetails[selectedProgramId]?.program?.rounds || 1
    ) || 1;
    const baseSeconds = selectedExercises.reduce((sum, ex) => {
      const dur = Number(ex.durationSeconds) || 0;
      const rest = Number(ex.restSeconds) || 0;
      return sum + dur + rest;
    }, 0);
    return {
      totalSeconds: baseSeconds * rounds,
      moments: selectedExercises.length,
    };
  }, [selectedExercises, selectedProgram, selectedProgramId, programDetails]);

  async function checkSession() {
    try {
      const data = await api('/api/me');
      setUser(data.user);
      setUserEquipment(data.equipment || []);
    } catch (err) {
      setUser(null);
    }
  }

  async function loadEquipment() {
    try {
      const data = await api('/api/equipment', { credentials: 'omit' });
      setAllEquipment(data.equipment);
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function loadPrograms() {
    try {
      const data = await api('/api/programs', { credentials: 'include' });
      setPrograms(data.programs);
      if (!selectedProgramId && data.programs.length) {
        selectProgram(data.programs[0].id);
      }
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function selectProgram(id) {
    setSelectedProgramId(id);
    if (programDetails[id]) return;
    try {
      const data = await api(`/api/programs/${id}`);
      setProgramDetails((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setStatus('');
    const body = JSON.stringify(authForm);
    try {
      const data =
        authMode === 'login'
          ? await api('/api/auth/login', { method: 'POST', body })
          : await api('/api/auth/register', { method: 'POST', body });
      setUser(data.user);
      setAuthForm({ name: '', email: '', password: '' });
      loadPrograms();
      loadSessions();
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleLogout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setUserEquipment([]);
  }

  async function handleSaveEquipment(slugs) {
    try {
      await api('/api/me/equipment', {
        method: 'PUT',
        body: JSON.stringify({ equipmentSlugs: slugs }),
      });
      setUserEquipment(allEquipment.filter((item) => slugs.includes(item.slug)));
      setStatus('Utrustning uppdaterad');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleSaveProgram(draft) {
    try {
      const body = JSON.stringify(draft);
      const data = await api('/api/programs', { method: 'POST', body });
      setPrograms((prev) => [data.program, ...prev]);
      setProgramDetails((prev) => ({
        ...prev,
        [data.program.id]: {
          program: data.program,
          exercises: data.exercises || [],
        },
      }));
      setSelectedProgramId(data.program.id);
      setView('dashboard');
      setStatus('Nytt pass sparat!');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleDeleteProgram(id) {
    try {
      await api(`/api/programs/${id}`, { method: 'DELETE' });
      setPrograms((prev) => prev.filter((p) => p.id !== id));
      setProgramDetails((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      if (selectedProgramId === id) {
        const next = programs.find((p) => p.id !== id);
        setSelectedProgramId(next?.id || null);
      }
      setStatus('Pass borttaget');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleSessionComplete(payload) {
    if (!user) return;
    try {
      const status = payload.status || 'completed';
      const elapsedSeconds = payload.elapsedSeconds ?? payload.durationSeconds ?? null;
      const percentComplete =
        payload.percentComplete ??
        (status === 'completed' && payload.durationSeconds ? 100 : null);

      await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          programId: selectedProgramId,
          durationSeconds: elapsedSeconds,
          notes: payload.notes || '',
          details: {
            ...(payload.details || {}),
            status,
            percentComplete,
          },
          sessionType: 'hiit',
          startedAt: payload.startedAt || null,
        }),
      });
      loadSessions();
      if (view === 'calendar') {
        loadCalendar();
        if (selectedDate) loadDaySessions(selectedDate);
      }
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function loadSessions() {
    try {
      const data = await api('/api/sessions/recent');
      setRecentSessions(data.sessions);
    } catch (err) {
      // ignore when logged out
    }
  }

  async function loadCalendar() {
    try {
      const data = await api(
        `/api/calendar/summary?from=${calendarRange.from}&to=${calendarRange.to}`
      );
      setCalendarDays(data.days || []);
      if (data.cap) setPointsCap(data.cap);
      if (!selectedDate || selectedDate < calendarRange.from || selectedDate > calendarRange.to) {
        const last = data.days?.[data.days.length - 1];
        if (last) setSelectedDate(last.date);
      }
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function loadWeekBars() {
    try {
      const data = await api('/api/calendar/weekbars?weeks=8');
      setWeekBarDays(data.days || []);
      if (data.cap) setPointsCap(data.cap);
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function loadDaySessions(date) {
    try {
      const data = await api(`/api/sessions?date=${date}`);
      setDaySessions(data.sessions || []);
    } catch (err) {
      setStatus(err.message);
    }
  }

  if (!user) {
    return (
      <div className="auth-hero">
        <div className="auth-title">7 MIN STUDIO</div>
        <div className="auth-card minimal">
          <h1>Logga in</h1>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === 'register' && (
              <label>
                Namn
                <input
                  type="text"
                  value={authForm.name}
                  onChange={(e) => setAuthForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ditt namn"
                  required
                />
              </label>
            )}
            <label>
              E-post
              <input
                type="email"
                value={authForm.email}
                onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="du@example.com"
                required
              />
            </label>
            <label>
              Lösenord
              <input
                type="password"
                value={authForm.password}
                onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Minst 6 tecken"
                required
                minLength={6}
              />
            </label>
            <button type="submit">{authMode === 'login' ? 'Logga in' : 'Skapa konto'}</button>
            <div className="auth-toggle">
              {authMode === 'login' ? 'Ny här?' : 'Har redan konto?'}
              <button
                type="button"
                className="link-button"
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              >
                {authMode === 'login' ? 'Registrera dig' : 'Logga in istället'}
              </button>
            </div>
          </form>

          {status && <div className="status">{status}</div>}
        </div>
      </div>
    );
  }

  const equipmentSlugs = userEquipment.map((e) => e.slug);

  if (view === 'calendar') {
    return (
      <div className="page">
        <NavBar
          user={user}
          view={view}
          onChangeView={setView}
          onLogout={handleLogout}
          onNewProgram={() => setView('builder')}
        />

        {status && <div className="status floating">{status}</div>}

        <div className="grid">
          <section className="panel hero">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Top-bars</p>
                <h2>Senaste 8 veckor</h2>
              </div>
              <span className="badge">Cap {pointsCap}p/dag</span>
            </div>
            <WeekBars days={weekBarDays} cap={pointsCap} />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Kalender</p>
                <h2>28 dagar</h2>
              </div>
            </div>
            <CalendarGrid days={calendarDays} selectedDate={selectedDate} onSelect={setSelectedDate} />

            <div className="panel-header" style={{ marginTop: '1rem' }}>
              <div>
                <p className="eyebrow">Pass</p>
                <h2>{selectedDate}</h2>
              </div>
            </div>
            {daySessions?.length ? (
              <div className="day-session-list">
                {daySessions.map((s) => (
                  <div key={s.id} className="day-session">
                    <div className="session-title">
                      {s.session_type || 'other'} • {s.duration_sec ? `${s.duration_sec}s` : 'okänd tid'}
                    </div>
                    <div className="session-meta">
                      {s.started_at
                        ? new Date(s.started_at).toLocaleTimeString('sv-SE', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                      {' • '}
                      {s.source}
                    </div>
                    {s.notes && <p className="session-notes">{s.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p>Inga pass den dagen.</p>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <NavBar
        user={user}
        view={view}
        onChangeView={setView}
        onLogout={handleLogout}
        onNewProgram={() => setView('builder')}
      />

      {status && <div className="status floating">{status}</div>}

      <div className="grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Mina pass</p>
              <h2>Bibliotek</h2>
            </div>
            <button onClick={() => setView('builder')}>Nytt pass</button>
          </div>
          <div className="program-list">
            {programs.map((program) => (
              <button
                key={program.id}
                className={`program-card ${selectedProgramId === program.id ? 'active' : ''}`}
                onClick={() => selectProgram(program.id)}
              >
                <div className="program-title">{program.title}</div>
                <div className="program-meta">
                  {program.rounds} varv • {program.is_public ? 'Delad' : 'Privat'}
                </div>
                <div className="program-meta subtle">
                  {programStats[program.id]
                    ? `${Math.round(programStats[program.id].totalSeconds / 60)} min • ${
                        programStats[program.id].moments
                      } moment`
                    : '— min • — moment'}
                </div>
                <p className="program-desc">{program.description || 'Inget upplägg än'}</p>
                <div className="card-actions">
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectProgram(program.id);
                      setView('builder');
                    }}
                  >
                    ✏️ Editera
                  </button>
                  {program.user_id && (
                    <button
                      type="button"
                      className="ghost tiny danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Ta bort detta pass?')) {
                          handleDeleteProgram(program.id);
                        }
                      }}
                    >
                      🗑 Ta bort
                    </button>
                  )}
                </div>
              </button>
            ))}
            {!programs.length && <p>Du har inga pass än. Skapa ett via Bygg-läget.</p>}
          </div>
        </section>

        <section className="panel hero">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Timer</p>
              <h2>{selectedProgram?.title || 'Inget pass valt'}</h2>
            </div>
            <span className="badge">{selectedExercises.length} moment</span>
          </div>

          <WorkoutTimer
            program={{
              ...(selectedProgram || { title: 'Välj pass', rounds: 1 }),
              rounds: selectedProgram?.rounds || 1,
            }}
            exercises={selectedExercises.length ? selectedExercises : defaultExercises}
            stats={selectedProgramStats}
            onComplete={handleSessionComplete}
          />
        </section>

        <section className="panel">
          {view === 'builder' && (
            <ProgramEditor
              onSave={handleSaveProgram}
              prefill={selectedProgram ? { program: selectedProgram, exercises: selectedExercises } : null}
            />
          )}
          {view === 'equipment' && (
            <EquipmentSelector
              allEquipment={allEquipment}
              selected={equipmentSlugs}
              onSave={handleSaveEquipment}
            />
          )}
          {view === 'dashboard' && (
            <div>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Progress</p>
                  <h2>Dina senaste pass</h2>
                </div>
              </div>
              <SessionList sessions={recentSessions} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
