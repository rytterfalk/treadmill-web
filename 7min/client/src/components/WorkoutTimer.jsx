import { useEffect, useMemo, useState } from 'react';

function playTone(frequency = 720) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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

function WorkoutTimer({ program, exercises, onComplete }) {
  const rounds = Math.max(program?.rounds || 1, 1);

  const schedule = useMemo(() => {
    if (!exercises?.length) return [];
    const seq = [];
    for (let round = 0; round < rounds; round += 1) {
      exercises.forEach((ex, idx) => {
        seq.push({
          type: 'exercise',
          label: ex.title || `Moment ${idx + 1}`,
          duration: Number(ex.durationSeconds) || 30,
          rest: Number(ex.restSeconds) || 0,
          round: round + 1,
          notes: ex.notes || '',
        });
        if (Number(ex.restSeconds) > 0) {
          seq.push({
            type: 'rest',
            label: 'Vila',
            duration: Number(ex.restSeconds) || 0,
            round: round + 1,
            notes: '',
          });
        }
      });
      if (round < rounds - 1) {
        seq.push({
          type: 'rest',
          label: 'Vila mellan varv',
          duration: 20,
          round: round + 1,
          notes: '',
        });
      }
    }
    return seq;
  }, [exercises, rounds]);

  const scheduleKey = useMemo(
    () => schedule.map((s) => `${s.label}-${s.duration}-${s.type}`).join('|'),
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

  const currentStep = schedule[stepIndex];

  useEffect(() => {
    setStepIndex(0);
    setRemaining(schedule[0]?.duration || 0);
    setStatus('idle');
    setElapsed(0);
    setCountdown(3);
  }, [scheduleKey]);

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
        if (step.type === 'exercise' && (nextTime === halfway || (nextTime <= 5 && nextTime > 0))) {
          playTone(nextTime <= 5 ? 540 : 760);
        }

        if (nextTime <= 0) {
          const nextIndex = stepIndex + 1;
          if (nextIndex >= schedule.length) {
            setStatus('done');
            onComplete?.({
              durationSeconds: totalDuration,
              details: { programTitle: program?.title },
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

  function start() {
    if (!schedule.length) return;
    setCountdown(3);
    setStatus('countdown');
    if (!remaining) setRemaining(schedule[stepIndex]?.duration || 0);
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
  }

  const percent =
    totalDuration > 0 ? Math.min(100, Math.round((elapsed / totalDuration) * 100)) : 0;
  const stepProgress =
    currentStep?.duration > 0
      ? Math.min(100, Math.round(((currentStep.duration - remaining) / currentStep.duration) * 100))
      : 0;

  const nextStep = schedule[stepIndex + 1];

  return (
    <div className="timer-shell">
      <div className="time-row">
        <div>
          <p className="eyebrow">Aktuellt moment</p>
          <div className="time-display">
            {status === 'countdown'
              ? `${countdown}`
              : `${String(remaining || 0).padStart(2, '0')}s`}
          </div>
          <div className="step-title">
            {status === 'countdown'
              ? 'Start om några sekunder'
              : currentStep?.label || 'Välj ett pass'}
          </div>
          <div className="step-meta">
            Varv {currentStep?.round || 1} / {rounds} •{' '}
            {currentStep?.type === 'exercise' ? 'Kör hårt' : 'Vila'}
          </div>
        </div>
        <div className="next-block">
          <p className="eyebrow">Nästa</p>
          <div className="next-title">{nextStep?.label || '---'}</div>
          <div className="next-meta">
            {nextStep ? `${nextStep.duration}s` : 'Du är klar när timern når noll'}
          </div>
        </div>
      </div>

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
      </div>

      <div className="mini-steps">
        {schedule.map((step, idx) => (
          <div
            key={`${step.label}-${idx}`}
            className={`mini-step ${
              idx === stepIndex ? 'active' : idx < stepIndex ? 'done' : ''
            }`}
          >
            <div className="mini-label">{step.label}</div>
            <div className="mini-meta">
              {step.duration}s • Varv {step.round}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkoutTimer;
