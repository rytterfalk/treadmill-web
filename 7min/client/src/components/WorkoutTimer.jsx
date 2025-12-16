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
    if (step?.type === 'exercise' && step.audioUrl && lastAudioPlayedRef.current !== stepIndex) {
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

  const nextStep = schedule[stepIndex + 1];
  const totalMinutes = Math.max(1, Math.round(totalDuration / 60));

  return (
    <div className="timer-shell">
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
          <div className="next-title">{nextStep?.label || '---'}</div>
          <div className="next-meta">
            {nextStep ? `${nextStep.duration}s` : 'Du är klar när timern når noll'}
          </div>
          <div className="next-meta">
            {stats?.moments ? `${stats.moments} moment` : '— moment'} •{' '}
            {stats?.totalSeconds ? `${Math.round(stats.totalSeconds / 60)} min` : '— min'}
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

      <div className="controls">
        {status !== 'running' && status !== 'countdown' && <button onClick={start}>Starta</button>}
        {status === 'countdown' && <button className="ghost" onClick={pause}>Stoppa nedräkning</button>}
        {status === 'running' && (
          <button className="ghost" onClick={pause}>
            Pausa
          </button>
        )}
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
