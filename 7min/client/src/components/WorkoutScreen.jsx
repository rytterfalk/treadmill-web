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
  const [completedResult, setCompletedResult] = useState(null);

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

  const WORKOUT_CSS = `/* workout fullscreen overlay - DARK THEME touch-first mobile UI */
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
  background:
    radial-gradient(circle at 20% 10%, rgba(247, 199, 43, 0.12), transparent 45%),
    radial-gradient(circle at 80% 90%, rgba(245, 158, 11, 0.08), transparent 45%),
    linear-gradient(180deg, #1a1a1a 0%, #252525 50%, #1a1a1a 100%);
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
  color: #ffffff;
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
  color: #ffffff;
}

.workout-header .eyebrow {
  color: #f7c72b;
}

.workout-submeta {
  font-size: 0.9rem;
  color: #b0b0b0;
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
  gap: 0.6rem;
  overflow: visible;
}

.workout-content .timer-shell.full-timer {
  background: rgba(37, 37, 37, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid #3a3a3a;
  border-radius: 20px;
  padding: 0.75rem;
  box-shadow: 0 12px 40px rgba(0,0,0,0.4);
}

.workout-content .time-row {
  display: none;
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
  gap: 0.7rem;
}

.workout-content .ring-wrap {
  width: 45vmin;
  max-width: 90vw;
}

.workout-content .ring-time {
  font-size: 12vmin;
  color: #ffffff;
}

.workout-content .ring-sub {
  font-size: 3vmin;
  color: #ffffff;
}

.workout-content .ring-sub.muted {
  color: #b0b0b0;
}

.workout-content .timer-actions {
  width: 100%;
  max-width: 90vw;
  display: flex;
  gap: 2vmin;
  flex-wrap: nowrap;
}

.workout-content .timer-actions button {
  flex: 1;
  min-height: 6vh;
  font-size: 2.2vmin;
  border-radius: 1.5vmin;
  touch-action: manipulation;
}

.workout-content .up-next {
  flex: 0 0 auto;
  background: rgba(51, 51, 51, 0.95);
  border: 1px solid #3a3a3a;
  border-radius: 16px;
  padding: 0.85rem;
}

.workout-content .up-next .eyebrow {
  color: #f7c72b;
}

.workout-content .next-list {
  max-height: 130px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.workout-content .next-item {
  padding: 0.6rem 0.75rem;
  background: #252525;
  border: 1px solid #3a3a3a;
  border-radius: 10px;
}

.workout-content .next-name {
  color: #ffffff;
}

.workout-content .secondary-actions {
  flex-wrap: wrap;
  gap: 8px;
}

.workout-content .secondary-actions button {
  min-height: 46px;
  padding: 0.6rem 1rem;
  font-size: 0.9rem;
  background: #333333;
  border: 1px solid #3a3a3a;
  color: #b0b0b0;
}

.workout-content .secondary-actions button:hover {
  border-color: #f7c72b;
  color: #ffffff;
}

.workout-content .progress {
  flex-shrink: 0;
  background: #333333;
}

.workout-content .progress-bar {
  background: linear-gradient(135deg, #f7c72b 0%, #f59e0b 100%);
}

.workout-actions .ghost {
  background: rgba(51, 51, 51, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 2px solid #3a3a3a;
  border-radius: 14px;
  padding: 12px 16px;
  font-weight: 600;
  min-height: 48px;
  color: #ffffff;
  touch-action: manipulation;
}

.workout-actions .ghost:hover {
  border-color: #f7c72b;
}

/* Larger screens: side-by-side layout */
@media (min-width: 700px) {
  .workout-content .immersive {
    flex-direction: row;
    align-items: stretch;
    gap: 4vmin;
  }

  .workout-content .ring-card {
    flex: 1.5;
    justify-content: center;
  }

  .workout-content .ring-wrap {
    width: 35vw;
    max-width: 50vh;
  }

  .workout-content .ring-time {
    font-size: min(10vw, 15vh);
  }

  .workout-content .ring-sub {
    font-size: min(2.5vw, 3.5vh);
  }

  .workout-content .up-next {
    flex: 1;
    max-width: 30vw;
    padding: 2vmin;
  }

  .workout-content .timer-actions {
    max-width: 60vw;
    margin: 0 auto;
  }

  .workout-content .timer-actions button {
    min-height: 7vh;
    font-size: min(2.5vw, 3vh);
    border-radius: 2vmin;
  }

  .workout-header h2 {
    font-size: min(3vw, 4vh);
  }
}

/* Completion screen */
.completion-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 24px;
  min-height: 60vh;
  animation: fadeInUp 0.6s ease-out;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.completion-icon {
  font-size: 80px;
  margin-bottom: 16px;
  animation: bounce 0.8s ease-out 0.3s both;
}

@keyframes bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

.completion-title {
  font-size: 2.5rem;
  font-weight: 800;
  background: linear-gradient(135deg, #f7c72b 0%, #f59e0b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px 0;
}

.completion-subtitle {
  font-size: 1.25rem;
  color: var(--text-secondary, #b0b0b0);
  margin: 0 0 32px 0;
}

.completion-stats {
  display: flex;
  gap: 32px;
  margin-bottom: 40px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 24px;
  background: rgba(255,255,255,0.05);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.1);
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #f7c72b;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary, #b0b0b0);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.completion-button {
  min-height: 56px;
  padding: 16px 40px;
  font-size: 1.1rem;
  font-weight: 600;
  background: linear-gradient(135deg, #f7c72b 0%, #f59e0b 100%);
  color: #1a1a1a;
  border: none;
  border-radius: 28px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.completion-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(247, 199, 43, 0.3);
}

.completion-button:active {
  transform: translateY(0);
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
          {completedResult ? (
            <div className="completion-screen">
              <div className="completion-icon">🎉</div>
              <h1 className="completion-title">Grattis!</h1>
              <p className="completion-subtitle">Ditt pass är slutfört!</p>
              <div className="completion-stats">
                <div className="stat-item">
                  <span className="stat-value">{Math.round((completedResult.durationSeconds || 0) / 60)}</span>
                  <span className="stat-label">minuter</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{stats?.moments || 0}</span>
                  <span className="stat-label">moment</span>
                </div>
              </div>
              <button
                className="completion-button"
                onClick={() => (window.location.href = '/')}
              >
                Tillbaka till startsidan
              </button>
            </div>
          ) : (
            <WorkoutTimer
              key={program?.id ?? `loading:${programId || ''}`}
              program={program}
              exercises={exercises}
              stats={stats}
              compact
              onComplete={(result) => {
                console.log('Workout done', result);
                setCompletedResult(result);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default WorkoutScreen;
