import { useEffect, useMemo, useState } from 'react';
import './index.css';
import './App.css';
import NavBar from './components/NavBar';
import ProgramEditor from './components/ProgramEditor';
import WorkoutTimer from './components/WorkoutTimer';
import EquipmentSelector from './components/EquipmentSelector';
import SessionList from './components/SessionList';

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
    }));
  }, [programDetails, selectedProgramId]);

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

  async function handleSessionComplete(payload) {
    if (!user) return;
    try {
      await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          programId: selectedProgramId,
          durationSeconds: payload.durationSeconds,
          notes: payload.notes || '',
          details: payload.details || null,
        }),
      });
      loadSessions();
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

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="tag">Prototyp • 7 min trainer</div>
          <h1>Bygg och kör dina pass på ett ställe</h1>
          <p className="lede">
            Spara progress, registrera utrustning och starta timer med ljud för halvtid och
            sista sekunderna. Allt körs på din egen Pi med SQLite.
          </p>

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

          <div className="feature-grid">
            <div>
              <strong>Passbyggare</strong>
              <p>Bestäm moment, tid, vila och antal varv. Spara för senare.</p>
            </div>
            <div>
              <strong>Ljudsignal</strong>
              <p>Ping vid halvtid och countdown sista 5 sekunderna.</p>
            </div>
            <div>
              <strong>Progress</strong>
              <p>Spara sessions, utrustning och få rekommenderade upplägg.</p>
            </div>
          </div>

          {status && <div className="status">{status}</div>}
        </div>
      </div>
    );
  }

  const equipmentSlugs = userEquipment.map((e) => e.slug);

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
                <p className="program-desc">{program.description || 'Inget upplägg än'}</p>
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
