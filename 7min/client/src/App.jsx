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
import DailyChallenge from './components/DailyChallenge';
import AdminPanel from './components/AdminPanel';
import CircuitEditor from './components/CircuitEditor';
import CircuitTimer from './components/CircuitTimer';

const defaultExercises = [
  { title: 'Jumping Jacks', durationSeconds: 30, restSeconds: 5, notes: '' },
  { title: 'Push-ups', durationSeconds: 30, restSeconds: 10, notes: '' },
  { title: 'Planka', durationSeconds: 40, restSeconds: 15, notes: 'Håll höfterna stilla' },
];

// Helper to get local date as YYYY-MM-DD string (respects user's timezone)
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  const [weekChallenges, setWeekChallenges] = useState([]);
  const [selectedProgressDate, setSelectedProgressDate] = useState(null); // For Progress view day filter
  const [selectedDate, setSelectedDate] = useState(() => {
    return getLocalDateString();
  });
  const [daySessions, setDaySessions] = useState([]);
  const [pointsCap, setPointsCap] = useState(60);
  const [calendarRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 27); // 28 dagar
    return {
      from: getLocalDateString(start),
      to: getLocalDateString(end),
    };
  });
  const [favorites, setFavorites] = useState([]); // Array of { program_id, user_id, user_name }
  const [showQuickSelect, setShowQuickSelect] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null); // For editing existing programs
  const [showCreateTypePicker, setShowCreateTypePicker] = useState(false);
  const [hiitCollapsed, setHiitCollapsed] = useState(false);
  const [todayThing, setTodayThing] = useState(null);
  const [todayThingStatus, setTodayThingStatus] = useState('idle');
  const [lastWorkout, setLastWorkout] = useState(null);
  const [lastWorkoutLoaded, setLastWorkoutLoaded] = useState(false);
  const [progressivePrograms, setProgressivePrograms] = useState([]);
  const [selectedProgressiveProgramId, setSelectedProgressiveProgramId] = useState(null);
  const [progressiveDays, setProgressiveDays] = useState([]);
  const [progressiveStatus, setProgressiveStatus] = useState('idle');
  const [selectedProgramDayDate, setSelectedProgramDayDate] = useState(null);

  // Circuit state
  const [circuitPrograms, setCircuitPrograms] = useState([]);
  const [circuitProgramDetails, setCircuitProgramDetails] = useState({});
  const [selectedCircuitId, setSelectedCircuitId] = useState(null);
  const [circuitCollapsed, setCircuitCollapsed] = useState(false);
  const [showCircuitPicker, setShowCircuitPicker] = useState(false);

  // Helper to format duration
  function formatDuration(seconds) {
    if (!seconds) return 'Okänd tid';
    const mins = Math.round(seconds / 60);
    if (mins < 1) return `${seconds}s`;
    return `${mins} min`;
  }

  // Helper to get user-specific localStorage key
  function getUserKey(key) {
    return user ? `7min_${user.id}_${key}` : `7min_${key}`;
  }

  // Load favorites from server
  async function loadFavorites() {
    try {
      const data = await api('/api/favorites');
      setFavorites(data.favorites || []);
    } catch {
      setFavorites([]);
    }
  }

  // Toggle favorite (shared via API)
  async function toggleFavorite(programId) {
    if (!user) return;
    const existing = favorites.find((f) => f.program_id === programId && f.user_id === user.id);
    try {
      if (existing) {
        await api(`/api/favorites/${programId}`, { method: 'DELETE' });
        setFavorites((prev) => prev.filter((f) => !(f.program_id === programId && f.user_id === user.id)));
      } else {
        await api(`/api/favorites/${programId}`, { method: 'POST' });
        setFavorites((prev) => [...prev, { program_id: programId, user_id: user.id, user_name: user.name }]);
      }
    } catch (err) {
      setStatus(err.message);
    }
  }

  // Check if program is favorited by any user
  function isFavorited(programId) {
    return favorites.some((f) => f.program_id === programId);
  }

  // Check if current user has favorited this program
  function isMyFavorite(programId) {
    return user && favorites.some((f) => f.program_id === programId && f.user_id === user.id);
  }

  // Get who favorited a program
  function getFavoriteUsers(programId) {
    return favorites
      .filter((f) => f.program_id === programId)
      .map((f) => f.user_name);
  }

  // Sort programs with favorites first
  const sortedPrograms = useMemo(() => {
    return [...programs].sort((a, b) => {
      const aFav = isFavorited(a.id);
      const bFav = isFavorited(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0;
    });
  }, [programs, favorites]);

  // Get favorite programs for quick select (all favorites from all users)
  const favoritePrograms = useMemo(() => {
    const favProgramIds = [...new Set(favorites.map((f) => f.program_id))];
    return programs.filter((p) => favProgramIds.includes(p.id));
  }, [programs, favorites]);

  useEffect(() => {
    loadEquipment();
    loadPrograms();
    checkSession();
  }, []);

  // Load user-specific settings when user logs in
  useEffect(() => {
    if (user) {
      loadSessions();
      loadFavorites();
      // Load user-specific selected program
      try {
        const savedProgramId = localStorage.getItem(getUserKey('selectedProgram'));
        if (savedProgramId) setSelectedProgramId(Number(savedProgramId));
      } catch {}
      // Load user-specific HIIT collapsed state
      try {
        setHiitCollapsed(localStorage.getItem(getUserKey('hiitCollapsed')) === 'true');
      } catch {}
      // Load user-specific circuit settings
      try {
        const savedCircuitId = localStorage.getItem(getUserKey('selectedCircuit'));
        if (savedCircuitId) setSelectedCircuitId(Number(savedCircuitId));
        setCircuitCollapsed(localStorage.getItem(getUserKey('circuitCollapsed')) === 'true');
      } catch {}
    } else {
      setFavorites([]);
    }
  }, [user]);

  // Save HIIT collapsed state (user-specific)
  useEffect(() => {
    if (!user) return;
    try { localStorage.setItem(getUserKey('hiitCollapsed'), hiitCollapsed ? 'true' : 'false'); } catch {}
  }, [hiitCollapsed, user]);

  // Save selected program (user-specific)
  useEffect(() => {
    if (!user || !selectedProgramId) return;
    try { localStorage.setItem(getUserKey('selectedProgram'), String(selectedProgramId)); } catch {}
  }, [selectedProgramId, user]);

  // Save circuit collapsed state and selected circuit
  useEffect(() => {
    if (!user) return;
    try { localStorage.setItem(getUserKey('circuitCollapsed'), circuitCollapsed ? 'true' : 'false'); } catch {}
  }, [circuitCollapsed, user]);

  useEffect(() => {
    if (!user || !selectedCircuitId) return;
    try { localStorage.setItem(getUserKey('selectedCircuit'), String(selectedCircuitId)); } catch {}
  }, [selectedCircuitId, user]);

  useEffect(() => {
    if (!user) return;
    if (view !== 'dashboard') return;
    loadTodayThing();
    loadDaySessions(getLocalDateString());
    loadCircuitPrograms();
  }, [user, view]);

  useEffect(() => {
    if (user && view === 'calendar') {
      loadCalendar();
      loadWeekBars();
      loadWeekSessions();
      loadWeekChallenges();
      loadProgressivePrograms();
    }
  }, [user, view, calendarRange.from, calendarRange.to]);

  useEffect(() => {
    if (!user) return;
    if (view === 'programs' || view === 'builder' || view === 'progressive-wizard' || view === 'circuit-editor') {
      loadProgressivePrograms();
      loadCircuitPrograms();
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

  async function handleRenameProgram(id, currentTitle) {
    const newTitle = window.prompt('Nytt namn på passet:', currentTitle);
    if (!newTitle || newTitle.trim() === currentTitle) return;
    try {
      const data = await api(`/api/programs/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      setPrograms((prev) =>
        prev.map((p) => (p.id === id ? { ...p, title: data.program.title } : p))
      );
      setProgramDetails((prev) => {
        if (!prev[id]) return prev;
        return {
          ...prev,
          [id]: {
            ...prev[id],
            program: { ...prev[id].program, title: data.program.title },
          },
        };
      });
      setStatus('Passet omdöpt!');
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

  // Circuit functions
  async function loadCircuitPrograms() {
    try {
      const data = await api('/api/circuit/programs');
      setCircuitPrograms(data.programs || []);
    } catch (err) {
      console.error('Failed to load circuit programs:', err);
    }
  }

  async function loadCircuitProgramDetails(id) {
    if (circuitProgramDetails[id]) return circuitProgramDetails[id];
    try {
      const data = await api(`/api/circuit/programs/${id}`);
      setCircuitProgramDetails((prev) => ({ ...prev, [id]: data }));
      return data;
    } catch (err) {
      setStatus(err.message);
      return null;
    }
  }

  async function selectCircuitProgram(id) {
    setSelectedCircuitId(id);
    await loadCircuitProgramDetails(id);
  }

  async function handleSaveCircuit(circuitData) {
    try {
      const data = await api('/api/circuit/programs', {
        method: 'POST',
        body: JSON.stringify(circuitData),
      });
      setCircuitPrograms((prev) => [data.program, ...prev]);
      setCircuitProgramDetails((prev) => ({
        ...prev,
        [data.program.id]: { program: data.program, exercises: data.exercises },
      }));
      setSelectedCircuitId(data.program.id);
      setView('dashboard');
      setStatus('Circuit-pass sparat!');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleDeleteCircuit(id) {
    try {
      await api(`/api/circuit/programs/${id}`, { method: 'DELETE' });
      setCircuitPrograms((prev) => prev.filter((p) => p.id !== id));
      setCircuitProgramDetails((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      if (selectedCircuitId === id) {
        setSelectedCircuitId(circuitPrograms.find((p) => p.id !== id)?.id || null);
      }
      setStatus('Circuit-pass borttaget');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function handleCircuitComplete(payload) {
    if (!user) return;
    try {
      await api('/api/circuit/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus(`Circuit klart! ${payload.roundsCompleted} varv på ${Math.round(payload.totalSeconds / 60)} min`);
      loadDaySessions(getLocalDateString());
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
          programTitle: selectedProgram?.title || null,
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
      loadDaySessions(getLocalDateString());
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

  function getWeekRange() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      from: getLocalDateString(monday),
      to: getLocalDateString(sunday),
    };
  }

  async function loadWeekSessions() {
    try {
      const { from, to } = getWeekRange();
      const data = await api(`/api/workout-sessions?from=${from}&to=${to}&limit=200`);
      setWeekSessions(data.workouts || []);
    } catch (err) {
      setWeekSessions([]);
    }
  }

  async function loadWeekChallenges() {
    try {
      const { from, to } = getWeekRange();
      const data = await api(`/api/challenges/history?from=${from}&to=${to}`);
      setWeekChallenges(data.challenges || []);
    } catch (err) {
      setWeekChallenges([]);
    }
  }

  async function loadDaySessions(date) {
    try {
      const data = await api(`/api/workout-sessions?date=${date}&limit=200`);
      setDaySessions(data.workouts || []);
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function loadLastWorkout() {
    try {
      const data = await api('/api/workout-sessions/recent?limit=1');
      setLastWorkout((data.workouts || [])[0] || null);
      setLastWorkoutLoaded(true);
    } catch (err) {
      // ignore
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
    const fromIso = getLocalDateString(from);
    const toIso = getLocalDateString(to);

    const data = await api(`/api/progressive-programs/${programId}?from=${fromIso}&to=${toIso}`);
    setProgressiveDays(data.days || []);
    setSelectedProgramDayDate(null);
    return data.program;
  }

  function startOfWeekIso(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const diff = day === 0 ? -6 : 1 - day; // Monday as start
    d.setDate(d.getDate() + diff);
    return getLocalDateString(d);
  }

  function addDaysIso(iso, offset) {
    // Parse the date as local time, not UTC
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + offset);
    return getLocalDateString(d);
  }

  const selectedProgressiveProgram = useMemo(() => {
    if (!selectedProgressiveProgramId) return null;
    return progressivePrograms.find((p) => p.id === selectedProgressiveProgramId) || null;
  }, [progressivePrograms, selectedProgressiveProgramId]);

  const nextTestDate = useMemo(() => {
    const todayIso = getLocalDateString();
    const next = progressiveDays.find(
      (d) => d.day_type === 'test' && d.status === 'planned' && d.date >= todayIso
    );
    return next?.date || null;
  }, [progressiveDays]);

  const upcomingRows = useMemo(() => {
    const todayIso = getLocalDateString();
    const byDate = new Map(progressiveDays.map((d) => [d.date, d]));
    return Array.from({ length: 14 }, (_, i) => {
      const date = addDaysIso(todayIso, i);
      return { date, day: byDate.get(date) || null };
    });
  }, [progressiveDays]);

  const selectedProgramDay = useMemo(() => {
    if (!selectedProgramDayDate) return null;
    return progressiveDays.find((d) => d.date === selectedProgramDayDate) || null;
  }, [progressiveDays, selectedProgramDayDate]);

  function programDayPlanSummary(day) {
    if (!day?.plan) return '';
    if (day.plan.method === 'submax') {
      const sets = Array.isArray(day.plan.sets) ? day.plan.sets : [];
      const reps = sets.length ? Number(sets[0]?.target_reps) || 0 : 0;
      const rest = sets.length ? Number(sets[0]?.rest_sec) || 0 : 0;
      return `${sets.length} set • ${reps || '—'} reps • vila ${rest || '—'}s`;
    }
    if (day.plan.method === 'ladder') {
      const steps = day.plan.ladders?.[0]?.steps || [];
      const top = steps.length ? steps[steps.length - 1] : null;
      return `Ladder 1–${top || '—'} • ${steps.length} steg`;
    }
    if (day.plan.method === 'test') {
      return 'Max-test (reps)';
    }
    return '';
  }

  const lastWorkoutSummary = useMemo(() => {
    if (!lastWorkout) return null;
    const sec = Number(lastWorkout.duration_sec);
    let durationLabel = '';
    if (Number.isFinite(sec) && sec > 0) {
      durationLabel = `${Math.floor(sec / 60)} min ${sec % 60 || 0}s`;
    } else if (lastWorkout.started_at && lastWorkout.ended_at) {
      const s = new Date(lastWorkout.started_at);
      const e = new Date(lastWorkout.ended_at);
      const sec2 = Math.max(0, Math.round((e - s) / 1000));
      durationLabel = `${Math.floor(sec2 / 60)} min ${sec2 % 60 || 0}s`;
    }
    const label =
      lastWorkout.session_type === 'progressive'
        ? `Progressivt • ${lastWorkout.program_method || ''}`.trim()
        : lastWorkout.session_type === 'hiit'
          ? 'HIIT'
          : 'Pass';
    const exercise = lastWorkout.program_exercise_key || null;

    let repsLabel = '';
    if (lastWorkout.program_day_result_json) {
      const r = lastWorkout.program_day_result_json;
      if (r.sets?.length) {
        const total = r.sets.reduce((sum, s) => sum + (Number(s.actual_reps) || 0), 0);
        repsLabel = `${total} reps`;
      } else if (Array.isArray(r.steps)) {
        const total = r.steps.reduce((sum, s) => sum + (Number(s) || 0), 0);
        repsLabel = `${total} reps`;
      }
    }
    return {
      label,
      durationLabel,
      repsLabel,
      exercise,
      sessionType: lastWorkout.session_type,
      id: lastWorkout.id,
    };
  }, [lastWorkout]);

  function formatExerciseLabel(exerciseKey) {
    const key = String(exerciseKey || '').trim().toLowerCase();
    if (!key) return '';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function formatDurationLong(seconds, startedAt, endedAt) {
    const sec = Number(seconds);
    if (Number.isFinite(sec) && sec > 0) {
      return `${Math.floor(sec / 60)} min ${sec % 60 || 0}s`;
    }
    if (startedAt && endedAt) {
      const s = new Date(startedAt);
      const e = new Date(endedAt);
      const sec2 = Math.max(0, Math.round((e - s) / 1000));
      return `${Math.floor(sec2 / 60)} min ${sec2 % 60 || 0}s`;
    }
    return '';
  }

  function workoutDayKey(workout) {
    return (
      workout?.day ||
      workout?.started_at?.slice(0, 10) ||
      workout?.ended_at?.slice(0, 10) ||
      workout?.created_at?.slice(0, 10) ||
      ''
    );
  }

  function totalRepsFromWorkout(workout) {
    const r = workout?.program_day_result_json || null;
    if (!r) return 0;
    if (Array.isArray(r.sets)) {
      return r.sets.reduce((sum, s) => sum + (Number(s.actual_reps) || 0), 0);
    }
    if (Array.isArray(r.steps)) {
      return r.steps.reduce((sum, s) => sum + (Number(s) || 0), 0);
    }
    return 0;
  }

  function workoutTitle(workout) {
    const type = workout?.session_type || 'other';
    if (type === 'progressive') {
      const exercise = formatExerciseLabel(workout?.program_exercise_key) || 'Progressivt';
      const method = String(workout?.program_method || 'progressivt');
      return `${exercise} • ${method}`;
    }
    if (type === 'hiit') return 'HIIT';
    if (type === 'strength') return 'Styrka';
    if (type === 'run') return 'Löpning';
    if (type === 'treadmill') return 'Löpband';
    if (type === 'mobility') return 'Rörlighet';
    if (type === 'test') return 'Test';
    return 'Pass';
  }

  const todayThingSummary = useMemo(() => {
    if (todayThing?.kind !== 'program_day') return null;
    const day = todayThing.program_day || null;
    const program = todayThing.program || null;
    const exercise = program?.exercise_key || '';

    const result = day?.result || null;
    let repsLabel = '';
    if (result?.sets?.length) {
      const total = result.sets.reduce((sum, s) => sum + (Number(s.actual_reps) || 0), 0);
      repsLabel = total ? `${total} reps` : '';
    } else if (Array.isArray(result?.steps)) {
      const total = result.steps.reduce((sum, s) => sum + (Number(s) || 0), 0);
      repsLabel = total ? `${total} reps` : '';
    }

    const durationLabel = formatDurationLong(
      day?.workout_duration_sec,
      day?.workout_started_at,
      day?.workout_ended_at
    );

    return { repsLabel, durationLabel, exercise };
  }, [todayThing]);

  if (!user) {
    return (
      <div className="auth-hero">
        <div className="auth-title">7 MIN STUDIO</div>
        <div className="auth-card minimal">
          <h1>Logga in</h1>

          <form className="auth-form" onSubmit={handleAuthSubmit} autoComplete="on">
            {authMode === 'register' && (
              <label>
                Namn
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
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
                name="email"
                autoComplete={authMode === 'login' ? 'username' : 'email'}
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
                name="password"
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
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
      ? weekSessions.filter((s) => workoutDayKey(s) === selectedProgressDate)
      : weekSessions;

    // Filter challenges by selected day
    const filteredChallenges = selectedProgressDate
      ? weekChallenges.filter((c) => c.date === selectedProgressDate)
      : weekChallenges;

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
                {filteredSessions.map((s) => {
                  const iso = s.started_at || s.ended_at || s.created_at;
                  const d = iso ? new Date(iso) : null;
                  const duration =
                    formatDurationLong(s.duration_sec, s.started_at, s.ended_at) || 'Okänd tid';
                  const repsTotal = totalRepsFromWorkout(s);
                  return (
                    <div key={s.id} className="session">
                      <div className="session-title">{workoutTitle(s)}</div>
                      <div className="session-meta">
                        {duration} •{' '}
                        {d
                          ? d.toLocaleString('sv-SE', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </div>
                      {repsTotal ? <div className="session-meta subtle">{repsTotal} reps</div> : null}
                      {s.notes && <p className="session-notes">{s.notes}</p>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">
                {selectedProgressDate ? 'Inga pass denna dag.' : 'Inga pass denna vecka ännu. Dags att köra! 💪'}
              </p>
            )}
          </section>

          {/* Challenges section */}
          {filteredChallenges.length > 0 && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">{selectedProgressDate ? selectedDayLabel : 'Veckans utmaningar'}</p>
                  <h2>Utmaningar</h2>
                </div>
                <span className="badge">
                  {filteredChallenges.reduce((sum, c) => sum + (c.total_reps || 0), 0)} reps
                </span>
              </div>
              <div className="session-list">
                {filteredChallenges.map((c) => (
                  <div key={c.id} className="session challenge-session">
                    <div className="session-title">
                      🎯 {c.exercise}
                    </div>
                    <div className="session-meta">
                      {c.sets_count || 0} set • {c.total_reps || 0} reps • mål: {c.target_reps}/set
                    </div>
                    <div className="session-meta subtle">
                      var {c.interval_minutes} min • {c.ended_at ? 'Avslutad' : 'Pågående'}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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
                  {upcomingRows.map((row) => {
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
                    const isSelected = row.date === selectedProgramDayDate;
                    const rowClass = `week-row ${isSelected ? 'active' : ''}`;
                    return (
                      <button
                        key={row.date}
                        type="button"
                        className={rowClass}
                        onClick={() => setSelectedProgramDayDate(row.date)}
                        style={{ textAlign: 'left' }}
                      >
                        <div className="week-date">{label}</div>
                        <div className="week-type">{type}</div>
                        <div className={badgeClass}>{statusText}</div>
                      </button>
                    );
                  })}
                </div>

                {selectedProgramDay ? (
                  <div className="workout-card" style={{ marginTop: '0.75rem' }}>
                    <div className="muted" style={{ marginBottom: '0.4rem' }}>
                      {new Date(selectedProgramDay.date).toLocaleDateString('sv-SE', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                      })}
                      {' • '}
                      {selectedProgressiveProgram?.exercise_key} • {selectedProgressiveProgram?.method}
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                      {selectedProgramDay.day_type?.toUpperCase?.() || '—'} • {selectedProgramDay.status}
                    </div>
                    {programDayPlanSummary(selectedProgramDay) ? (
                      <div className="muted">{programDayPlanSummary(selectedProgramDay)}</div>
                    ) : null}
                    {selectedProgramDay.plan?.method === 'submax' && Array.isArray(selectedProgramDay.plan?.sets) ? (
                      <div className="muted" style={{ marginTop: '0.5rem' }}>
                        {selectedProgramDay.plan.sets.map((s, idx) => (
                          <div key={`set_${idx}`}>
                            Set {idx + 1}: {s.target_reps} reps • vila {s.rest_sec}s
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {selectedProgramDay.plan?.method === 'ladder' &&
                    Array.isArray(selectedProgramDay.plan?.ladders?.[0]?.steps) ? (
                      <div className="muted" style={{ marginTop: '0.5rem' }}>
                        Steg: {selectedProgramDay.plan.ladders[0].steps.join('–')}
                      </div>
                    ) : null}
                    {selectedProgramDay.plan?.notes ? (
                      <div className="muted" style={{ marginTop: '0.5rem' }}>
                        {selectedProgramDay.plan.notes}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  // CIRCUIT EDITOR VIEW
  if (view === 'circuit-editor') {
    return (
      <div className="page">
        <NavBar user={user} view={view} onChangeView={setView} onLogout={handleLogout} />
        {status && <div className="status floating">{status}</div>}
        <div className="grid">
          <section className="panel">
            <CircuitEditor
              onSave={handleSaveCircuit}
              onCancel={() => setView('programs')}
            />
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
                const programFavorited = isFavorited(program.id);
                const myFav = isMyFavorite(program.id);
                const favUsers = getFavoriteUsers(program.id);
                return (
                  <div
                    key={program.id}
                    className={`program-card ${selectedProgramId === program.id ? 'active' : ''}`}
                  >
                    <button
                      className={`fav-btn ${myFav ? 'is-fav' : ''} ${programFavorited && !myFav ? 'others-fav' : ''}`}
                      onClick={() => toggleFavorite(program.id)}
                      title={myFav ? 'Ta bort din favorit' : programFavorited ? `Lägg till (${favUsers.join(', ')} gillar)` : 'Lägg till favorit'}
                    >
                      {myFav ? '★' : programFavorited ? '★' : '☆'}
                    </button>
                    <div className="program-content" onClick={() => { selectProgram(program.id); setView('dashboard'); }}>
                      <div className="program-title">{program.title}</div>
                      <div className="program-meta">
                        {program.rounds} varv • {program.is_public ? 'Delad' : 'Privat'}
                        {programFavorited && <span className="fav-users"> • ★ {favUsers.join(', ')}</span>}
                      </div>
                      <div className="program-meta subtle">
                        {programStats[program.id]
                          ? `${Math.round(programStats[program.id].totalSeconds / 60)} min • ${programStats[program.id].moments} moment`
                          : '— min • — moment'}
                      </div>
                      <p className="program-desc">{program.description || 'Inget upplägg än'}</p>
                    </div>
                    <div className="card-actions">
                      {program.user_id === user?.id && (
                        <button type="button" className="ghost tiny" onClick={() => handleRenameProgram(program.id, program.title)}>
                          ✎ Byt namn
                        </button>
                      )}
                      <button type="button" className="ghost tiny" onClick={() => { selectProgram(program.id); setEditingProgram(program); setView('builder'); }}>
                        ✏️ Kopiera & redigera
                      </button>
                      {(program.user_id === null && !program.is_public) || program.user_id === user?.id ? (
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

          {/* Circuit section */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Rep-baserat</p>
                <h3>Circuit</h3>
              </div>
              <button className="primary small" onClick={() => setView('circuit-editor')}>
                + Nytt circuit
              </button>
            </div>

            {circuitPrograms.length > 0 ? (
              <div className="program-list">
                {circuitPrograms.map((program) => (
                  <div
                    key={program.id}
                    className={`program-card ${selectedCircuitId === program.id ? 'active' : ''}`}
                  >
                    <div className="program-content" onClick={() => { selectCircuitProgram(program.id); setView('dashboard'); }}>
                      <div className="program-title">{program.title}</div>
                      <div className="program-meta">
                        {program.rest_seconds}s paus • {program.is_public ? 'Delad' : 'Privat'}
                      </div>
                      <p className="program-desc">{program.description || 'Rep-baserat träningspass'}</p>
                    </div>
                    <div className="card-actions">
                      {program.user_id === user?.id && (
                        <button type="button" className="ghost tiny danger" onClick={() => { if (window.confirm('Ta bort detta circuit?')) handleDeleteCircuit(program.id); }}>
                          🗑 Ta bort
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                Inga circuit-pass ännu. Skapa ett rep-baserat träningspass!
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

  // ADMIN VIEW
  if (view === 'admin' && user?.is_admin === 1) {
    return (
      <div className="page">
        <NavBar user={user} view={view} onChangeView={setView} onLogout={handleLogout} />
        {status && <div className="status floating">{status}</div>}
        <div className="grid progress-grid">
          <section className="panel">
            <AdminPanel />
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
        {/* Only show "Dagens grej" if there's an active progressive program */}
        {todayThing?.kind === 'program_day' && (
        <section className="panel today-thing-panel today-thing-compact">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dagens grej</p>
              <h3>
                {`${todayThing.program?.exercise_key} • ${todayThing.program?.method}`}
              </h3>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge">
                {todayThing.program_day?.status === 'done'
                  ? 'genomförd'
                  : todayThing.program_day?.day_type}
              </span>
              {todayThing.program_day?.status === 'done' && todayThingSummary?.durationLabel ? (
                <span className="badge">{todayThingSummary.durationLabel}</span>
              ) : null}
              {todayThing.program_day?.status === 'done' && todayThingSummary?.repsLabel ? (
                <span className="badge">{todayThingSummary.repsLabel}</span>
              ) : null}
            </div>
          </div>

          {todayThing.program_day?.day_type === 'rest' ? (
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Vilodag. Kom tillbaka nästa träningsdag.
            </p>
          ) : todayThing.program_day?.status === 'done' ? (
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Genomförd.
              {todayThingSummary?.repsLabel
                ? ` ${formatExerciseLabel(todayThingSummary.exercise) || 'Totalt'}: ${
                    todayThingSummary.repsLabel
                  }.`
                : ''}
              {' '}Bra jobbat!
            </p>
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
        </section>
        )}

        {/* Daily Challenge */}
        <DailyChallenge
          currentUserId={user?.id}
          onSaveDay={async (summary) => {
            loadSessions();
            setStatus('Daglig utmaning sparad!');
            setTimeout(() => setStatus(''), 2000);
          }}
        />

        <section className={`panel hero start-panel ${hiitCollapsed ? 'collapsed' : ''}`}>
          <div className="panel-header clickable" onClick={() => setHiitCollapsed(!hiitCollapsed)}>
            <div>
              <p className="eyebrow">HIIT-pass</p>
              <h2>{selectedProgram?.title || 'Välj ett pass'} {hiitCollapsed ? '▶' : '▼'}</h2>
            </div>
            {!hiitCollapsed && (
              <button className="ghost" onClick={() => setShowQuickSelect(true)}>
                Byt träning ▾
              </button>
            )}
          </div>

          {!hiitCollapsed && (
            selectedProgram ? (
              <WorkoutTimer
                key={selectedProgram.id}
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
            )
          )}
        </section>

        {/* Circuit section */}
        <section className={`panel hero circuit-panel ${circuitCollapsed ? 'collapsed' : ''}`}>
          <div className="panel-header clickable" onClick={() => setCircuitCollapsed(!circuitCollapsed)}>
            <div>
              <p className="eyebrow">Circuit-pass</p>
              <h2>
                {circuitProgramDetails[selectedCircuitId]?.program?.title || 'Välj ett circuit'}
                {circuitCollapsed ? ' ▶' : ' ▼'}
              </h2>
            </div>
            {!circuitCollapsed && (
              <button className="ghost" onClick={(e) => { e.stopPropagation(); setShowCircuitPicker(true); }}>
                Byt circuit ▾
              </button>
            )}
          </div>

          {!circuitCollapsed && (
            selectedCircuitId && circuitProgramDetails[selectedCircuitId] ? (
              <CircuitTimer
                key={selectedCircuitId}
                program={circuitProgramDetails[selectedCircuitId].program}
                exercises={circuitProgramDetails[selectedCircuitId].exercises}
                onComplete={handleCircuitComplete}
              />
            ) : (
              <div className="no-program-selected">
                <p>Inget circuit valt</p>
                <button onClick={() => setView('programs')}>Välj circuit</button>
              </div>
            )
          )}
        </section>

{/* Genomförda pass visas nu i "Veckans träning" i DailyChallenge-komponenten */}

        {/* Pass-väljare modal */}
        {showQuickSelect && (
          <div className="modal-overlay" onClick={() => setShowQuickSelect(false)}>
            <div className="modal program-picker-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Välj träningspass</h3>
                <button className="modal-close" onClick={() => setShowQuickSelect(false)}>✕</button>
              </div>
              <div className="program-picker-list">
                {favoritePrograms.length > 0 && (
                  <>
                    <div className="picker-section-label">★ Favoriter</div>
                    {favoritePrograms.map((p) => (
                      <button
                        key={p.id}
                        className={`picker-item ${selectedProgramId === p.id ? 'active' : ''}`}
                        onClick={() => {
                          selectProgram(p.id);
                          setShowQuickSelect(false);
                        }}
                      >
                        <span className="picker-title">{p.title}</span>
                        <span className="picker-meta">{programStats[p.id] ? `${Math.round(programStats[p.id].totalSeconds / 60)} min` : ''}</span>
                      </button>
                    ))}
                  </>
                )}
                <div className="picker-section-label">Alla pass</div>
                {programs.filter(p => !favoritePrograms.some(f => f.id === p.id)).map((p) => (
                  <button
                    key={p.id}
                    className={`picker-item ${selectedProgramId === p.id ? 'active' : ''}`}
                    onClick={() => {
                      selectProgram(p.id);
                      setShowQuickSelect(false);
                    }}
                  >
                    <span className="picker-title">{p.title}</span>
                    <span className="picker-meta">{programStats[p.id] ? `${Math.round(programStats[p.id].totalSeconds / 60)} min` : ''}</span>
                  </button>
                ))}
              </div>
              <div className="modal-footer">
                <button className="ghost" onClick={() => { setShowQuickSelect(false); setView('programs'); }}>
                  Hantera pass →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Circuit-väljare modal */}
        {showCircuitPicker && (
          <div className="modal-overlay" onClick={() => setShowCircuitPicker(false)}>
            <div className="modal program-picker-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Välj circuit-pass</h3>
                <button className="modal-close" onClick={() => setShowCircuitPicker(false)}>✕</button>
              </div>
              <div className="program-picker-list">
                {circuitPrograms.length > 0 ? (
                  circuitPrograms.map((p) => (
                    <button
                      key={p.id}
                      className={`picker-item ${selectedCircuitId === p.id ? 'active' : ''}`}
                      onClick={() => {
                        selectCircuitProgram(p.id);
                        setShowCircuitPicker(false);
                      }}
                    >
                      <span className="picker-title">{p.title}</span>
                      <span className="picker-meta">{p.rest_seconds}s paus</span>
                    </button>
                  ))
                ) : (
                  <p className="empty-state">Inga circuit-pass än</p>
                )}
              </div>
              <div className="modal-footer">
                <button className="ghost" onClick={() => { setShowCircuitPicker(false); setView('circuit-editor'); }}>
                  + Skapa nytt circuit →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
