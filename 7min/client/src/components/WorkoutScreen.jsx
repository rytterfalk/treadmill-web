import { useEffect, useMemo, useState } from 'react';
import WorkoutTimer from './WorkoutTimer';

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

function WorkoutScreen({ programId }) {
  const [program, setProgram] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.classList.add('workout-lock');
    return () => document.body.classList.remove('workout-lock');
  }, []);

  useEffect(() => {
    if (!programId) {
      setStatus('error');
      setError('Saknar pass-id');
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const data = await api(`/api/programs/${programId}`);
        if (cancelled) return;
        setProgram(data.program);
        setExercises(
          (data.exercises || []).map((ex) => ({
            title: ex.title,
            durationSeconds: ex.duration_seconds,
            restSeconds: ex.rest_seconds,
            notes: ex.notes || '',
            audioUrl: ex.audio_url || null,
            halfAudioUrl: ex.half_audio_url || null,
          }))
        );
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  const stats = useMemo(() => {
    if (!exercises.length) return { totalSeconds: 0, moments: 0 };
    const rounds = Number(program?.rounds || 1) || 1;
    const baseSeconds = exercises.reduce((sum, ex) => {
      const dur = Number(ex.durationSeconds) || 0;
      const rest = Number(ex.restSeconds) || 0;
      return sum + dur + rest;
    }, 0);
    return { totalSeconds: baseSeconds * rounds, moments: exercises.length };
  }, [program, exercises]);

  if (status === 'loading') {
    return (
      <div className="workout-screen">
        <div className="workout-header">
          <div>
            <p className="eyebrow">Startar pass</p>
            <h2>Laddar...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="workout-screen">
        <div className="workout-header">
          <div>
            <p className="eyebrow">Hoppsan</p>
            <h2>{error || 'Kunde inte ladda passet'}</h2>
            <button onClick={() => (window.location.href = '/')}>Tillbaka</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workout-screen">
      <div className="workout-header">
        <div>
          <p className="eyebrow">Workout Mode</p>
          <h2>{program?.title || 'Pass'}</h2>
          <div className="workout-submeta">
            {program?.rounds ? `${program.rounds} varv` : '1 varv'} •{' '}
            {stats.totalSeconds ? `${Math.round(stats.totalSeconds / 60)} min` : 'Okänd tid'}
          </div>
        </div>
        <div className="workout-actions">
          <button className="ghost" onClick={() => (window.location.href = '/')}>
            Avsluta
          </button>
        </div>
      </div>

      <div className="workout-content">
        <WorkoutTimer
          program={program}
          exercises={exercises}
          stats={stats}
          compact
          onComplete={(result) => {
            console.log('Workout done', result); // keep simple; logging only
          }}
        />
      </div>
    </div>
  );
}

export default WorkoutScreen;
