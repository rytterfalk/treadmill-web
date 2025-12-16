import { useEffect, useMemo, useRef, useState } from 'react';

let audioCtx;
function getAudioContext() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function playTone(frequency = 720) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch (err) {
    // Best-effort: ljud är valfritt
  }
}

function formatSeconds(totalSeconds) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function WorkoutTimer({ program, exercises, onComplete, stats }) {
  const [rounds, setRounds] = useState(1);
  const [restBetweenExercises, setRestBetweenExercises] = useState(10);
  const [restBetweenRounds, setRestBetweenRounds] = useState(40);
  const voicePlayerRef = useRef(null);
  const [showSteps, setShowSteps] = useState(false);

  const schedule = useMemo(() => {
    if (!exercises?.length) return [];
    const seq = [];
    const rbe = Math.max(0, Number(restBetweenExercises) || 0);
    const rbr = Math.max(0, Number(restBetweenRounds) || 0);
    const runRounds = Math.max(1, Number(rounds) || 1);
    for (let round = 0; round < runRounds; round += 1) {
      exercises.forEach((ex, idx) => {
        seq.push({
          type: 'exercise',
          label: ex.title || `Moment ${idx + 1}`,
          duration: Number(ex.durationSeconds) || 30,
          rest: rbe,
          round: round + 1,
          notes: ex.notes || '',
          audioUrl: ex.audioUrl || null,
          halfAudioUrl: ex.halfAudioUrl || null,
        });
        if (rbe > 0) {
          seq.push({
            type: 'rest',
            label: 'Vila',
            duration: rbe,
            round: round + 1,
            notes: '',
          });
        }
      });
      if (round < runRounds - 1 && rbr > 0) {
        seq.push({
          type: 'rest',
          label: 'Vila mellan varv',
          duration: rbr,
          round: round + 1,
          notes: '',
        });
      }
    }
    return seq;
  }, [exercises, rounds, restBetweenExercises, restBetweenRounds]);

  const scheduleKey = useMemo(
    () =>
      schedule
        .map((s) => `${s.label}-${s.duration}-${s.type}-${s.audioUrl || ''}-${s.halfAudioUrl || ''}`)
        .join('|'),
    [schedule]
  );

  const totalDuration = useMemo(
    () => schedule.reduce((sum, step) => sum + Number(step.duration || 0), 0),
    [schedule]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [remaining, setRemaining] = useState(schedule[0]?.duration || 0);
  const [status, setStatus] = useState('idle'); // idle | countdown | running | paused | done
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const wakeLockRef = useRef(null);
  const lastAudioPlayedRef = useRef(null);

  const currentStep = schedule[stepIndex];

  useEffect(() => {
    setStepIndex(0);
    setRemaining(schedule[0]?.duration || 0);
    setStatus('idle');
    setElapsed(0);
    setCountdown(3);
    lastAudioPlayedRef.current = null;
  }, [scheduleKey]);

  useEffect(() => {
    const step = schedule[stepIndex];
    if (status !== 'running') return;
    const prev = schedule[stepIndex - 1];
    const previousWasRest = prev?.type === 'rest';
    // Spela paus-meddelande precis när vi går från vila till nytt moment.
    if (
      previousWasRest &&
      step?.type === 'exercise' &&
      step.audioUrl &&
      lastAudioPlayedRef.current !== stepIndex
    ) {
      try {
        const player = voicePlayerRef.current || new Audio();
        player.src = step.audioUrl;
        player.currentTime = 0;
        voicePlayerRef.current = player;
        player.play().catch(() => {});
        lastAudioPlayedRef.current = stepIndex;
      } catch (err) {
        // ignore playback errors
      }
    }
  }, [stepIndex, schedule, status]);

  // Keep screen awake (best-effort) while timern kör
  useEffect(() => {
    let cancelled = false;
    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator && status === 'running') {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      } catch (err) {
        // ignore; not supported or blocked
      }
    }
    if (status === 'running') {
      requestWakeLock();
    } else if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    const onVisibility = () => {
      if (wakeLockRef.current && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'countdown') return undefined;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          playTone(860);
          setStatus('running');
          return 3;
        }
        playTone(520);
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status !== 'running' || !schedule.length) return undefined;
    const interval = setInterval(() => {
      setRemaining((time) => {
        const step = schedule[stepIndex];
        if (!step) return 0;

        const nextTime = time - 1;
        const halfway = Math.floor(step.duration / 2);
        if (step.type === 'exercise') {
          if (nextTime === halfway) {
            if (step.halfAudioUrl) {
              try {
                const player = voicePlayerRef.current || new Audio();
                player.src = step.halfAudioUrl;
                player.currentTime = 0;
                voicePlayerRef.current = player;
                player.play().catch(() => {});
              } catch (err) {
                playTone(760);
              }
            } else {
              playTone(760);
            }
          } else if (nextTime <= 5 && nextTime > 0) {
            playTone(540);
          }
        }
        if (step.type === 'rest' && nextTime <= 3 && nextTime > 0) {
          playTone(520);
        }

        if (nextTime <= 0) {
          const nextIndex = stepIndex + 1;
          if (nextIndex >= schedule.length) {
            setStatus('done');
            onComplete?.({
              durationSeconds: totalDuration,
              details: { programTitle: program?.title },
              status: 'completed',
              percentComplete: 100,
            });
            return 0;
          }
          setStepIndex(nextIndex);
          return schedule[nextIndex].duration;
        }

        return nextTime;
      });
      setElapsed((t) => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [status, stepIndex, schedule, program?.title, totalDuration, onComplete]);

  function startCountdown(targetIndex = 0) {
    if (!schedule[targetIndex]) return;
    playTone(520);
    setStepIndex(targetIndex);
    setRemaining(schedule[targetIndex].duration || 0);
    setCountdown(3);
    setStatus('countdown');
  }

  function start() {
    if (!schedule.length) return;
    if (status === 'paused' && remaining > 0) {
      playTone(520);
      setCountdown(3);
      setStatus('countdown');
      return;
    }
    startCountdown(stepIndex || 0);
  }

  function pause() {
    setStatus('paused');
  }

  function reset() {
    setStatus('idle');
    setStepIndex(0);
    setRemaining(schedule[0]?.duration || 0);
    setElapsed(0);
    setCountdown(3);
    setRounds(1);
    setRestBetweenExercises(10);
    setRestBetweenRounds(40);
  }

  function abortAndSave() {
    if (!schedule.length || status === 'idle') return;
    const elapsedSeconds = elapsed;
    const percentComplete =
      totalDuration > 0 ? Math.min(100, Math.round((elapsedSeconds / totalDuration) * 100)) : 0;
    setStatus('idle');
    setStepIndex(0);
    setRemaining(schedule[0]?.duration || 0);
    setElapsed(0);
    setCountdown(3);
    onComplete?.({
      status: 'aborted',
      durationSeconds: elapsedSeconds,
      elapsedSeconds,
      percentComplete,
      details: { programTitle: program?.title },
    });
  }

  const percent =
    totalDuration > 0 ? Math.min(100, Math.round((elapsed / totalDuration) * 100)) : 0;
  const stepProgress =
    currentStep?.duration > 0
      ? Math.min(100, Math.round(((currentStep.duration - remaining) / currentStep.duration) * 100))
      : 0;

  const nextExercises = useMemo(
    () => schedule.slice(stepIndex + 1).filter((s) => s.type === 'exercise'),
    [schedule, stepIndex]
  );
  const nextExercise = nextExercises[0];
  const nextExerciseAfter = nextExercises.slice(0, 3);
  const previousExerciseIndex = useMemo(() => {
    for (let i = stepIndex - 1; i >= 0; i -= 1) {
      if (schedule[i]?.type === 'exercise') return i;
    }
    return null;
  }, [schedule, stepIndex]);
  const nextExerciseIndex = useMemo(() => {
    for (let i = stepIndex + 1; i < schedule.length; i += 1) {
      if (schedule[i]?.type === 'exercise') return i;
    }
    return null;
  }, [schedule, stepIndex]);
  const totalMinutes = Math.max(1, Math.round(totalDuration / 60));
  const totalRemaining = Math.max(0, totalDuration - elapsed);
  const isActive = status === 'running' || status === 'countdown' || status === 'paused';

  function jumpToExercise(targetIndex) {
    if (targetIndex == null || !schedule[targetIndex]) return;
    setStepIndex(targetIndex);
    setRemaining(schedule[targetIndex].duration || 0);
    if (status === 'idle' || status === 'done') {
      setStatus('paused');
    }
  }

  return (
    <div className={`timer-shell ${isActive ? 'full-timer' : ''}`}>
      <div className="time-row">
        <div>
          <p className="eyebrow">Total tid</p>
          <div className="time-display">{totalMinutes} min</div>
          <div className="step-title">
            {status === 'countdown' ? 'Nedräkning' : currentStep?.label || 'Välj ett pass'}
          </div>
          <div className="step-meta">
            {status === 'countdown'
              ? `${countdown}s`
              : `${String(remaining || 0).padStart(2, '0')}s kvar • Varv ${
                  currentStep?.round || 1
                } / ${rounds}`}
          </div>
        </div>
        <div className="next-block">
          <p className="eyebrow">Nästa</p>
          <div className="next-title">{nextExercise?.label || '---'}</div>
          <div className="next-meta">
            {nextExercise ? `${nextExercise.duration}s` : 'Du är klar när timern når noll'}
          </div>
          <div className="next-meta">
            {stats?.moments ? `${stats.moments} moment` : '— moment'} •{' '}
            {stats?.totalSeconds ? `${Math.round(stats.totalSeconds / 60)} min` : '— min'}
          </div>
        </div>
      </div>

      <div className={`immersive ${isActive ? 'active' : ''}`}>
        <div className="ring-card">
          <div className="ring-wrap">
            <svg className="ring" viewBox="0 0 240 240">
              <circle className="ring-track" cx="120" cy="120" r="108" />
              <circle
                className="ring-progress outer"
                cx="120"
                cy="120"
                r="108"
                style={{
                  strokeDasharray: `${2 * Math.PI * 108}px`,
                  strokeDashoffset: `${2 * Math.PI * 108 * (1 - stepProgress / 100)}px`,
                }}
              />
              <circle className="ring-track inner" cx="120" cy="120" r="88" />
              <circle
                className="ring-progress inner"
                cx="120"
                cy="120"
                r="88"
                style={{
                  strokeDasharray: `${2 * Math.PI * 88}px`,
                  strokeDashoffset: `${2 * Math.PI * 88 * (1 - percent / 100)}px`,
                }}
              />
            </svg>
            <div className="ring-center">
              <p className="eyebrow">{currentStep?.type === 'rest' ? 'Vila' : 'Nu kör vi'}</p>
              <div className="ring-time">
                {status === 'countdown' ? `${countdown}` : formatSeconds(remaining || 0)}
              </div>
              <div className="ring-sub">
                {status === 'countdown'
                  ? `${currentStep?.label || ''}`
                  : `${currentStep?.label || ''} • ${currentStep?.duration || 0}s`}
              </div>
              <div className="ring-sub muted">Totalt kvar {formatSeconds(totalRemaining)}</div>
            </div>
          </div>

          <div className="timer-actions">
            <button
              className="ghost"
              onClick={() => jumpToExercise(previousExerciseIndex)}
              disabled={previousExerciseIndex == null}
            >
              ← Föregående
            </button>
            {status !== 'running' && status !== 'countdown' ? (
              <button onClick={start}>Starta</button>
            ) : (
              <button className="ghost" onClick={pause}>
                Pausa
              </button>
            )}
            <button
              className="ghost"
              onClick={() => jumpToExercise(nextExerciseIndex)}
              disabled={nextExerciseIndex == null}
            >
              Nästa →
            </button>
          </div>
        </div>

        <div className="up-next">
          <div className="up-next-header">
            <p className="eyebrow">Kommande övningar</p>
            <span className="small-chip">
              {nextExercises.length ? `${nextExercises.length} kvar` : 'Inget mer'}
            </span>
          </div>
          <div className="next-list">
            {nextExerciseAfter.length ? (
              nextExerciseAfter.map((step, idx) => (
                <div className="next-item" key={`${step.label}-${idx}`}>
                  <div className="next-name">{step.label}</div>
                  <div className="next-meta">
                    {step.duration}s • Varv {step.round}
                  </div>
                </div>
              ))
            ) : (
              <div className="next-item empty">Inga fler övningar</div>
            )}
          </div>
          <div className="secondary-actions">
            <button className="ghost" onClick={reset}>
              Nollställ
            </button>
            <button className="ghost" onClick={() => setShowSteps((v) => !v)}>
              {showSteps ? 'Dölj moment' : 'Visa moment'}
            </button>
            {(status === 'running' || status === 'countdown' || status === 'paused') && (
              <button className="ghost danger" onClick={abortAndSave}>
                Avbryt och spara
              </button>
            )}
          </div>
        </div>
      </div>

      {status !== 'idle' && (
        <>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${percent}%` }} />
            <div className="progress-label">Total progress {percent}%</div>
          </div>
          <div className="progress secondary">
            <div className="progress-bar" style={{ width: `${stepProgress}%` }} />
            <div className="progress-label">
              Moment {stepIndex + 1} av {schedule.length}
            </div>
          </div>
        </>
      )}

      <div className="inline compact timer-config">
        <label>
          Varv
          <input
            type="number"
            min="1"
            value={rounds}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                setRounds('');
                return;
              }
              const num = Number(val);
              setRounds(Math.max(1, Number.isNaN(num) ? 1 : num));
            }}
          />
        </label>
        <label>
          Vila per moment (s)
          <input
            type="number"
            min="0"
            value={restBetweenExercises}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                setRestBetweenExercises('');
                return;
              }
              const num = Number(val);
              setRestBetweenExercises(Math.max(0, Number.isNaN(num) ? 0 : num));
            }}
          />
        </label>
        <label>
          Vila mellan varv (s)
          <input
            type="number"
            min="0"
            value={restBetweenRounds}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                setRestBetweenRounds('');
                return;
              }
              const num = Number(val);
              setRestBetweenRounds(Math.max(0, Number.isNaN(num) ? 0 : num));
            }}
          />
        </label>
      </div>

      {showSteps && (
        <div className="mini-steps">
          {schedule
            .map((step, idx) => ({ step, idx }))
            .filter(({ step }) => step.type === 'exercise')
            .map(({ step, idx }) => {
              const currentExerciseIndex =
                step.type === 'exercise' ? idx === stepIndex : false;
              const done = idx < stepIndex;
              return (
                <div
                  key={`${step.label}-${idx}`}
                  className={`mini-step ${currentExerciseIndex ? 'active' : done ? 'done' : ''}`}
                >
                  <div className="mini-label">{step.label}</div>
                  <div className="mini-meta">
                    {step.duration}s • Varv {step.round}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export default WorkoutTimer;
