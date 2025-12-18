import { useEffect, useMemo, useState } from 'react';
import './index.css';
import './App.css';
import NavBar from './components/NavBar';
import ProgramEditor from './components/ProgramEditor';
import WorkoutTimer from './components/WorkoutTimer';
import WorkoutScreen from './components/WorkoutScreen';
import ProgramDayScreen from './components/ProgramDayScreen';
import EquipmentSelector from './components/EquipmentSelector';
import SessionList from './components/SessionList';
import WeekBars from './components/WeekBars';
import WeekProgress from './components/WeekProgress';
import CalendarGrid from './components/CalendarGrid';
import ProgressiveProgramWizard from './components/ProgressiveProgramWizard';

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
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const message =
      data?.error ||
      (text && text.trim() ? `HTTP ${res.status}: ${text.slice(0, 200)}` : `HTTP ${res.status}`);
    throw new Error(message || 'Något gick fel');
  }
  return data;
}

function App() {
  const programDayMatch = useMemo(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/workout\/program-day\/([^/]+)/);
    return match ? match[1] : null;
  }, []);
  if (programDayMatch) return <ProgramDayScreen programDayId={programDayMatch} />;

  const workoutMatch = useMemo(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/(workout|play)\/([^/]+)/);
    if (!match) return null;
    if (match[2] === 'program-day') return null;
    return match[2];
  }, []);
  if (workoutMatch) return <WorkoutScreen programId={workoutMatch} />;

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
  const [weekSessions, setWeekSessions] = useState([]);
  const [selectedProgressDate, setSelectedProgressDate] = useState(null); // For Progress view day filter
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
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('7min_favorites') || '[]');
    } catch {
      return [];
    }
  });
  const [showQuickSelect, setShowQuickSelect] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null); // For editing existing programs
  const [showCreateTypePicker, setShowCreateTypePicker] = useState(false);
  const [todayThing, setTodayThing] = useState(null);
  const [todayThingStatus, setTodayThingStatus] = useState('idle');
  const [progressivePrograms, setProgressivePrograms] = useState([]);
  const [selectedProgressiveProgramId, setSelectedProgressiveProgramId] = useState(null);
  const [progressiveDays, setProgressiveDays] = useState([]);
  const [progressiveStatus, setProgressiveStatus] = useState('idle');

  // Helper to format duration
  function formatDuration(seconds) {
    if (!seconds) return 'Okänd tid';
    const mins = Math.round(seconds / 60);
    if (mins < 1) return `${seconds}s`;
    return `${mins} min`;
  }

  // Toggle favorite
  function toggleFavorite(programId) {
    setFavorites((prev) => {
      const next = prev.includes(programId)
        ? prev.filter((id) => id !== programId)
        : [...prev, programId];
      localStorage.setItem('7min_favorites', JSON.stringify(next));
      return next;
    });
  }

  // Sort programs with favorites first
  const sortedPrograms = useMemo(() => {
    return [...programs].sort((a, b) => {
      const aFav = favorites.includes(a.id);
      const bFav = favorites.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0;
    });
  }, [programs, favorites]);

  // Get favorite programs for quick select
  const favoritePrograms = useMemo(() => {
    return programs.filter((p) => favorites.includes(p.id));
  }, [programs, favorites]);

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
    if (!user) return;
    if (view !== 'dashboard') return;
    loadTodayThing();
  }, [user, view]);

  useEffect(() => {
    if (user && view === 'calendar') {
      loadCalendar();
      loadWeekBars();
      loadWeekSessions();
      loadProgressivePrograms();
    }
  }, [user, view, calendarRange.from, calendarRange.to]);

  useEffect(() => {
    if (!user) return;
    if (view === 'programs' || view === 'builder' || view === 'progressive-wizard') {
      loadProgressivePrograms();
    }
  }, [user, view]);

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

  async function handleDeactivateProgressiveProgram(id) {
    try {
      await api(`/api/progressive-programs/${id}/deactivate`, { method: 'POST' });
      setProgressivePrograms((prev) => prev.map((p) => (p.id === id ? { ...p, active: 0 } : p)));
      setStatus('Program avaktiverat');
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

  async function loadWeekSessions() {
    try {
      // Get current week (Mon-Sun)
      const today = new Date();
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const from = monday.toISOString().slice(0, 10);
      const to = sunday.toISOString().slice(0, 10);

      const data = await api(`/api/sessions/week?from=${from}&to=${to}`);
      setWeekSessions(data.sessions || []);
    } catch (err) {
      // Fallback to recent sessions if week endpoint doesn't exist
      const data = await api('/api/sessions/recent?limit=20');
      // Filter to current week
      const today = new Date();
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      monday.setHours(0, 0, 0, 0);

      const weekOnly = (data.sessions || []).filter(s => {
        const sessionDate = new Date(s.completed_at);
        return sessionDate >= monday;
      });
      setWeekSessions(weekOnly);
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

  async function loadTodayThing() {
    setTodayThingStatus('loading');
    try {
      const data = await api('/api/today');
      setTodayThing(data);
      setTodayThingStatus('ready');
    } catch (err) {
      setTodayThing({ kind: 'error', error: err.message });
      setTodayThingStatus('error');
    }
  }

  async function loadProgressivePrograms() {
    setProgressiveStatus('loading');
    try {
      const data = await api('/api/progressive-programs');
      const programs = data.programs || [];
      setProgressivePrograms(programs);
      const active = programs.find((p) => p.active) || programs[0] || null;
      const nextSelected = selectedProgressiveProgramId || active?.id || null;
      setSelectedProgressiveProgramId(nextSelected);
      if (nextSelected) {
        await loadProgressiveProgramDays(nextSelected);
      } else {
        setProgressiveDays([]);
      }
      setProgressiveStatus('ready');
    } catch (err) {
      setProgressiveStatus('error');
      setStatus(err.message);
    }
  }

  async function loadProgressiveProgramDays(programId) {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 13);
    const to = new Date(today);
    to.setDate(today.getDate() + 14);
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);

    const data = await api(`/api/progressive-programs/${programId}?from=${fromIso}&to=${toIso}`);
    setProgressiveDays(data.days || []);
    return data.program;
  }

  function startOfWeekIso(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const diff = day === 0 ? -6 : 1 - day; // Monday as start
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function addDaysIso(iso, offset) {
    const d = new Date(`${iso}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  const selectedProgressiveProgram = useMemo(() => {
    if (!selectedProgressiveProgramId) return null;
    return progressivePrograms.find((p) => p.id === selectedProgressiveProgramId) || null;
  }, [progressivePrograms, selectedProgressiveProgramId]);

  const nextTestDate = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const next = progressiveDays.find(
      (d) => d.day_type === 'test' && d.status === 'planned' && d.date >= todayIso
    );
    return next?.date || null;
  }, [progressiveDays]);

  const weekRows = useMemo(() => {
    const today = new Date();
    const monday = startOfWeekIso(today);
    const byDate = new Map(progressiveDays.map((d) => [d.date, d]));
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDaysIso(monday, i);
      return { date, day: byDate.get(date) || null };
    });
  }, [progressiveDays]);

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
    // Filter sessions by selected day if a day is selected
    const filteredSessions = selectedProgressDate
      ? weekSessions.filter((s) => s.completed_at?.slice(0, 10) === selectedProgressDate)
      : weekSessions;

    // Format selected day for display
    const selectedDayLabel = selectedProgressDate
      ? new Date(selectedProgressDate).toLocaleDateString('sv-SE', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        })
      : null;

    return (
      <div className="page">
        <NavBar
          user={user}
          view={view}
          onChangeView={setView}
          onLogout={handleLogout}
        />

        {status && <div className="status floating">{status}</div>}

        <div className="grid progress-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Denna vecka</p>
                <h2>Din träning</h2>
              </div>
              <span className="badge">{pointsCap}p/dag</span>
            </div>
            <WeekProgress
              days={weekBarDays}
              cap={pointsCap}
              selectedDate={selectedProgressDate}
              onSelectDate={setSelectedProgressDate}
            />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{selectedProgressDate ? selectedDayLabel : 'Veckans pass'}</p>
                <h2>Genomförda</h2>
              </div>
              <span className="badge">{filteredSessions.length} pass</span>
            </div>
            {filteredSessions?.length ? (
              <div className="session-list">
                {filteredSessions.map((s) => (
                  <div key={s.id} className="session">
                    <div className="session-title">{s.program_title || 'Eget pass'}</div>
                    <div className="session-meta">
                      {formatDuration(s.duration_seconds)} •{' '}
                      {new Date(s.completed_at).toLocaleString('sv-SE', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {s.notes && <p className="session-notes">{s.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                {selectedProgressDate ? 'Inga pass denna dag.' : 'Inga pass denna vecka ännu. Dags att köra! 💪'}
              </p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Progressivt</p>
                <h2>Program</h2>
              </div>
              {progressivePrograms.length ? (
                <select
                  value={selectedProgressiveProgramId || ''}
                  onChange={async (e) => {
                    const id = e.target.value || null;
                    setSelectedProgressiveProgramId(id);
                    if (id) await loadProgressiveProgramDays(id);
                  }}
                >
                  {progressivePrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.exercise_key} • {p.method} {p.active ? '' : '(inaktiv)'}
                    </option>
                  ))}
                </select>
              ) : (
                <button className="ghost" onClick={() => setView('programs')}>
                  Skapa →
                </button>
              )}
            </div>

            {progressiveStatus === 'loading' ? (
              <p className="empty-state">Laddar program…</p>
            ) : !selectedProgressiveProgram ? (
              <p className="empty-state">
                Inget aktivt program ännu. Skapa ett progressivt program under “Passen”.
              </p>
            ) : (
              <>
                <div className="progressive-meta">
                  <span className="badge">Max: {selectedProgressiveProgram.test_max}</span>
                  <span className="badge">Nästa test: {nextTestDate || '—'}</span>
                  <span className="badge">
                    Status: {selectedProgressiveProgram.active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </div>

                <div className="week-table">
                  {weekRows.map((row) => {
                    const label = new Date(row.date).toLocaleDateString('sv-SE', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    });
                    const day = row.day;
                    const type = day?.day_type || '—';
                    const statusText = day?.status || '—';
                    const badgeClass =
                      statusText === 'done'
                        ? 'badge ok'
                        : statusText === 'skipped'
                          ? 'badge warn'
                          : 'badge';
                    return (
                      <div key={row.date} className="week-row">
                        <div className="week-date">{label}</div>
                        <div className="week-type">{type}</div>
                        <div className={badgeClass}>{statusText}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  // PROGRAMS VIEW - "Passen"
  if (view === 'programs' || view === 'builder' || view === 'progressive-wizard') {
    return (
      <div className="page">
        <NavBar user={user} view={view} onChangeView={setView} onLogout={handleLogout} />
        {status && <div className="status floating">{status}</div>}

        <div className="grid programs-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Alla pass</p>
                <h2>Passen</h2>
              </div>
              <button
                onClick={() => {
                  setEditingProgram(null);
                  setShowCreateTypePicker((v) => !v);
                }}
              >
                + Skapa nytt pass
              </button>
            </div>
            {showCreateTypePicker && (
              <div className="create-type-picker">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateTypePicker(false);
                    setView('builder');
                  }}
                >
                  HIIT (befintligt)
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setShowCreateTypePicker(false);
                    setStatus('Styrka (v1) kommer snart.');
                  }}
                >
                  Styrka (stub)
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setShowCreateTypePicker(false);
                    setView('progressive-wizard');
                  }}
                >
                  Progressivt program
                </button>
              </div>
            )}
            <div className="program-list">
              {sortedPrograms.map((program) => {
                const isFav = favorites.includes(program.id);
                return (
                  <div
                    key={program.id}
                    className={`program-card ${selectedProgramId === program.id ? 'active' : ''}`}
                  >
                    <button
                      className={`fav-btn ${isFav ? 'is-fav' : ''}`}
                      onClick={() => toggleFavorite(program.id)}
                      title={isFav ? 'Ta bort favorit' : 'Lägg till favorit'}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                    <div className="program-content" onClick={() => { selectProgram(program.id); setView('dashboard'); }}>
                      <div className="program-title">{program.title}</div>
                      <div className="program-meta">
                        {program.rounds} varv • {program.is_public ? 'Delad' : 'Privat'}
                      </div>
                      <div className="program-meta subtle">
                        {programStats[program.id]
                          ? `${Math.round(programStats[program.id].totalSeconds / 60)} min • ${programStats[program.id].moments} moment`
                          : '— min • — moment'}
                      </div>
                      <p className="program-desc">{program.description || 'Inget upplägg än'}</p>
                    </div>
                    <div className="card-actions">
                      <button type="button" className="ghost tiny" onClick={() => { selectProgram(program.id); setEditingProgram(program); setView('builder'); }}>
                        ✏️ Editera
                      </button>
                      {(program.user_id === null && !program.is_public) || program.user_id ? (
                        <button type="button" className="ghost tiny danger" onClick={() => { if (window.confirm('Ta bort detta pass?')) handleDeleteProgram(program.id); }}>
                          🗑 Ta bort
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!programs.length && <p className="empty-state">Du har inga pass än. Skapa ett!</p>}
            </div>

            <hr className="panel-divider" />

            <div className="panel-header" style={{ marginTop: '0.75rem' }}>
              <div>
                <p className="eyebrow">Progressivt</p>
                <h3>Program</h3>
              </div>
              {progressivePrograms.length ? (
                <span className="badge">{progressivePrograms.length} st</span>
              ) : null}
            </div>

            {progressiveStatus === 'loading' ? (
              <p className="empty-state">Laddar program…</p>
            ) : progressivePrograms.length ? (
              <div className="program-list">
                {progressivePrograms.map((p) => (
                  <div key={p.id} className="program-card">
                    <div className="program-content">
                      <div className="program-title">
                        {p.exercise_key} • {p.method}
                      </div>
                      <div className="program-meta">Max: {p.test_max}</div>
                      <div className="program-meta subtle">{p.active ? 'Aktiv' : 'Inaktiv'}</div>
                    </div>
                    <div className="card-actions">
                      <button
                        type="button"
                        className="ghost tiny"
                        onClick={async () => {
                          setSelectedProgressiveProgramId(p.id);
                          await loadProgressiveProgramDays(p.id);
                          setView('calendar');
                        }}
                      >
                        📈 Visa
                      </button>
                      {p.active ? (
                        <button
                          type="button"
                          className="ghost tiny danger"
                          onClick={() => {
                            if (window.confirm('Avaktivera detta program?')) {
                              handleDeactivateProgressiveProgram(p.id);
                            }
                          }}
                        >
                          ⏹ Avbryt
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                Inga progressiva program ännu. Klicka “+ Skapa nytt pass” och välj “Progressivt program”.
              </p>
            )}
          </section>

          {view === 'builder' && (
            <section className="panel">
              <ProgramEditor
                onSave={(data) => { handleSaveProgram(data); setView('programs'); }}
                prefill={editingProgram ? { program: editingProgram, exercises: selectedExercises } : null}
              />
            </section>
          )}

          {view === 'progressive-wizard' && (
            <section className="panel">
              <ProgressiveProgramWizard
                onCancel={() => setView('programs')}
                onCreated={() => {
                  setView('dashboard');
                  loadTodayThing();
                  loadProgressivePrograms();
                  setStatus('Program skapat!');
                }}
              />
            </section>
          )}
        </div>
      </div>
    );
  }

  // EQUIPMENT VIEW
  if (view === 'equipment') {
    return (
      <div className="page">
        <NavBar user={user} view={view} onChangeView={setView} onLogout={handleLogout} />
        {status && <div className="status floating">{status}</div>}
        <div className="grid progress-grid">
          <section className="panel">
            <EquipmentSelector allEquipment={allEquipment} selected={equipmentSlugs} onSave={handleSaveEquipment} />
          </section>
        </div>
      </div>
    );
  }

  // START! VIEW - Main workout view (dashboard)
  return (
    <div className="page">
      <NavBar user={user} view={view} onChangeView={setView} onLogout={handleLogout} />
      {status && <div className="status floating">{status}</div>}

      <div className="start-view">
        <section className="panel today-thing-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dagens grej</p>
              <h3>
                {todayThing?.kind === 'program_day'
                  ? `${todayThing.program?.exercise_key} • ${todayThing.program?.method}`
                  : todayThingStatus === 'loading'
                    ? 'Laddar…'
                    : 'Inget planerat'}
              </h3>
            </div>
            {todayThing?.kind === 'program_day' ? (
              <span className="badge">{todayThing.program_day?.day_type}</span>
            ) : null}
          </div>

          {todayThing?.kind === 'program_day' ? (
            <>
              {todayThing.program_day?.day_type === 'rest' ? (
                <p className="empty-state">Vilodag. Kom tillbaka nästa träningsdag.</p>
              ) : todayThing.program_day?.day_type === 'workout' ? (
                <div className="actions-row">
                  <button
                    onClick={() =>
                      (window.location.href = `/workout/program-day/${todayThing.program_day.id}`)
                    }
                  >
                    Starta
                  </button>
                </div>
              ) : (
                <div className="actions-row">
                  <button
                    className="ghost"
                    onClick={() =>
                      (window.location.href = `/workout/program-day/${todayThing.program_day.id}`)
                    }
                  >
                    Starta test
                  </button>
                </div>
              )}
            </>
          ) : todayThingStatus === 'error' ? (
            <p className="empty-state">Kunde inte ladda dagens plan.</p>
          ) : (
            <div className="actions-row">
              <button className="ghost" onClick={() => setView('programs')}>
                Skapa progressivt program →
              </button>
            </div>
          )}
        </section>

        <section className="panel hero start-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Ditt träningspass</p>
              <h2>{selectedProgram?.title || 'Välj ett pass'}</h2>
            </div>
            <div className="quick-select-container">
              <button className="ghost" onClick={() => setShowQuickSelect(!showQuickSelect)}>
                Byt träning ▾
              </button>
              {showQuickSelect && (
                <div className="quick-select-dropdown">
                  {favoritePrograms.length > 0 && (
                    <>
                      <div className="dropdown-label">Favoriter</div>
                      {favoritePrograms.map((p) => (
                        <button key={p.id} className="dropdown-item" onClick={() => { selectProgram(p.id); setShowQuickSelect(false); }}>
                          ★ {p.title}
                        </button>
                      ))}
                      <div className="dropdown-divider" />
                    </>
                  )}
                  <button className="dropdown-item all-programs" onClick={() => { setShowQuickSelect(false); setView('programs'); }}>
                    Visa alla pass →
                  </button>
                </div>
              )}
            </div>
          </div>

          {selectedProgram ? (
            <WorkoutTimer
              program={{ ...selectedProgram, rounds: selectedProgram.rounds || 1 }}
              exercises={selectedExercises.length ? selectedExercises : defaultExercises}
              stats={selectedProgramStats}
              onComplete={handleSessionComplete}
            />
          ) : (
            <div className="no-program-selected">
              <p>Inget pass valt</p>
              <button onClick={() => setView('programs')}>Välj träningspass</button>
            </div>
          )}
        </section>

        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const todaySessions = recentSessions.filter(
            (s) => s.completed_at && s.completed_at.slice(0, 10) === today
          );
          if (todaySessions.length === 0) return null;
          return (
            <section className="panel today-sessions-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Idag</p>
                  <h3>Genomförda pass</h3>
                </div>
                <span className="badge">{todaySessions.length} pass</span>
              </div>
              <div className="today-sessions-list">
                {todaySessions.map((session) => (
                  <div key={session.id} className="today-session-item">
                    <div className="session-info">
                      <span className="session-title">{session.program_title || 'Eget pass'}</span>
                      <span className="session-duration">{formatDuration(session.duration_seconds)}</span>
                    </div>
                    <span className="session-time-small">
                      {new Date(session.completed_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}
      </div>
    </div>
  );
}

export default App;
