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
    // Robust iOS scroll lock: prevent the background page from scrolling while workout is active.
    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    body.classList.add('workout-lock');

    const prev = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      htmlOverflow: html.style.overflow,
    };

    // iOS Safari sometimes ignores overflow:hidden on body unless we also fix-position it.
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    return () => {
      body.classList.remove('workout-lock');

      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.width = prev.bodyWidth;
      html.style.overflow = prev.htmlOverflow;

      // Restore scroll position
      window.scrollTo(0, scrollY);
    };
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

  const WORKOUT_CSS = `/* workout fullscreen overlay */
.workout-screen{
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483647;
  background: #f3d35a; /* gul */
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100svh;
  height: 100dvh;
  overscroll-behavior: none;
}
.workout-header{
  flex: 0 0 auto;
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  padding: 14px 16px;
  padding-top: calc(14px + env(safe-area-inset-top));
  padding-left: calc(16px + env(safe-area-inset-left));
  padding-right: calc(16px + env(safe-area-inset-right));
}
.workout-content{
  flex: 1 1 auto;
  min-height: 0;
  display:flex;
  flex-direction:column;
  overflow: hidden;
  padding: 0 16px;
  padding-left: calc(16px + env(safe-area-inset-left));
  padding-right: calc(16px + env(safe-area-inset-right));
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
.workout-content > *{
  min-height: 0;
}
.workout-actions .ghost{
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 12px;
  padding: 10px 12px;
  font-weight: 600;
}
.workout-lock{ touch-action: none; }
`;

  if (status === 'loading') {
    return (
      <>
        <style>{WORKOUT_CSS}</style>
        <div className="workout-screen">
          <div className="workout-header">
            <div>
              <p className="eyebrow">Startar pass</p>
              <h2>Laddar...</h2>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (status === 'error') {
    return (
      <>
        <style>{WORKOUT_CSS}</style>
        <div className="workout-screen">
          <div className="workout-header">
            <div>
              <p className="eyebrow">Hoppsan</p>
              <h2>{error || 'Kunde inte ladda passet'}</h2>
              <button onClick={() => (window.location.href = '/')}>Tillbaka</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{WORKOUT_CSS}</style>
      <div className="workout-screen" role="application">
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
    </>
  );
}

export default WorkoutScreen;
