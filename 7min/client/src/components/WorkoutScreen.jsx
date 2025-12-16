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

    // Add lock class to both html and body for maximum compatibility
    html.classList.add('workout-lock');
    body.classList.add('workout-lock');

    const prev = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
    };

    // iOS Safari sometimes ignores overflow:hidden on body unless we also fix-position it.
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.height = '100%';
    html.style.height = '100%';

    // Prevent touch events from propagating to body
    const preventScroll = (e) => {
      // Allow scrolling within .next-list (the upcoming exercises list)
      if (e.target.closest('.next-list') || e.target.closest('.workout-content')) {
        return;
      }
      e.preventDefault();
    };

    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      html.classList.remove('workout-lock');
      body.classList.remove('workout-lock');

      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.width = prev.bodyWidth;
      body.style.height = prev.bodyHeight;
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;

      document.removeEventListener('touchmove', preventScroll);

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

  const WORKOUT_CSS = `/* workout fullscreen overlay - touch-first mobile UI */
html.workout-lock,
body.workout-lock {
  position: fixed !important;
  overflow: hidden !important;
  width: 100% !important;
  height: 100% !important;
  touch-action: none !important;
  overscroll-behavior: none !important;
  -webkit-overflow-scrolling: auto !important;
}

.workout-screen {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: radial-gradient(circle at 20% 15%, rgba(255,230,100,0.4), transparent 40%),
              radial-gradient(circle at 85% 10%, rgba(255,200,50,0.3), transparent 35%),
              linear-gradient(180deg, #ffe066 0%, #fff5cc 40%, #ffe066 100%);
  display: flex;
  flex-direction: column;
  width: 100vw;
  width: 100dvw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.workout-header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 8px;
  padding-top: max(12px, env(safe-area-inset-top, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}

.workout-header h2 {
  font-size: 1.3rem;
  margin: 0.1rem 0 0.2rem;
}

.workout-submeta {
  font-size: 0.9rem;
  color: #5a4d1a;
}

.workout-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 12px 12px;
  padding-left: max(12px, env(safe-area-inset-left, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.workout-content > * {
  min-height: 0;
  flex-shrink: 0;
}

.workout-content .timer-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: visible;
}

.workout-content .timer-shell.full-timer {
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.5);
  border-radius: 20px;
  padding: 0.6rem;
  box-shadow: 0 8px 32px rgba(200,160,40,0.15);
}

.workout-content .time-row {
  display: none; /* hide duplicate info in compact mode */
}

.workout-content .immersive {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  background: transparent;
  border: none;
  padding: 0;
  min-height: auto;
}

.workout-content .ring-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
}

.workout-content .ring-wrap {
  width: min(280px, 65vw);
  max-width: 300px;
}

.workout-content .ring-time {
  font-size: clamp(2.4rem, 10vw, 3.2rem);
}

.workout-content .ring-sub {
  font-size: 0.95rem;
}

.workout-content .timer-actions {
  width: 100%;
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
}

.workout-content .timer-actions button {
  flex: 1;
  min-height: 48px;
  font-size: 0.95rem;
  border-radius: 14px;
  touch-action: manipulation;
}

.workout-content .up-next {
  flex: 0 0 auto;
  background: rgba(255,255,255,0.7);
  border: 1px dashed rgba(200,160,50,0.4);
  border-radius: 14px;
  padding: 0.7rem;
}

.workout-content .next-list {
  max-height: 120px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.workout-content .next-item {
  padding: 0.5rem 0.6rem;
}

.workout-content .secondary-actions {
  flex-wrap: wrap;
  gap: 6px;
}

.workout-content .secondary-actions button {
  min-height: 44px;
  padding: 0.5rem 0.8rem;
  font-size: 0.85rem;
}

.workout-content .progress {
  flex-shrink: 0;
}

.workout-actions .ghost {
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  padding: 10px 14px;
  font-weight: 600;
  min-height: 44px;
  touch-action: manipulation;
}

/* Larger screens: side-by-side layout */
@media (min-width: 600px) and (min-height: 500px) {
  .workout-content .immersive {
    flex-direction: row;
    align-items: stretch;
  }
  .workout-content .ring-card {
    flex: 1.2;
  }
  .workout-content .up-next {
    flex: 0.8;
    max-width: 320px;
  }
  .workout-content .ring-wrap {
    width: min(320px, 45vw);
  }
}
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
