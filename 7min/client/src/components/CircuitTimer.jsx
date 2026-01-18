import { useCallback, useEffect, useRef, useState } from 'react';

// Audio context for beep sounds (lazy init)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Wake up AudioContext - must be called from a user gesture (click/touch)
function wakeAudio() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Play a silent tone to fully unlock audio on iOS
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0; // Silent
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.01);
  } catch {
    // ignore
  }
}

// Play a beep sound
function playBeep(frequency = 800, duration = 0.15, volume = 0.3) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch (e) {
    // Audio not available
  }
}

// Short beep for countdown
function playCountdownBeep() {
  playBeep(600, 0.1, 0.25);
}

// Longer beep for GO!
function playStartBeep() {
  playBeep(900, 0.3, 0.4);
}

// Soft tick sound for each second during exercises
function playTick() {
  playBeep(800, 0.08, 0.06); // Medium freq, low volume, very short
}

function CircuitTimer({ program, exercises, onComplete }) {
  const [phase, setPhase] = useState('ready'); // ready | countdown | exercise | rest | done
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);
  const [round, setRound] = useState(1);
  const [restCountdown, setRestCountdown] = useState(0);
  const [countdownValue, setCountdownValue] = useState(3); // For initial countdown
  const [exerciseElapsed, setExerciseElapsed] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [exerciseTimes, setExerciseTimes] = useState([]); // Array of { exercise, round, seconds }
  const [isPaused, setIsPaused] = useState(false);

  const intervalRef = useRef(null);
  const voicePlayerRef = useRef(null); // For playing recorded audio
  const lastBeepRef = useRef(-1); // Track last beeped second to avoid duplicates
  const lastAudioPlayedRef = useRef(null); // Track which audio was last played

  const currentExercise = exercises[currentExerciseIdx];
  const restSeconds = program?.rest_seconds || 30;

  // Timer tick
  useEffect(() => {
    if (phase === 'ready' || phase === 'done' || isPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      lastBeepRef.current = -1; // Reset beep tracker
      return;
    }

    intervalRef.current = setInterval(() => {
      if (phase === 'countdown') {
        setCountdownValue((c) => {
          const newValue = c - 1;

          // Play countdown beeps at 3, 2, 1
          if (newValue > 0 && newValue !== lastBeepRef.current) {
            playCountdownBeep();
            lastBeepRef.current = newValue;
          }

          if (newValue <= 0) {
            // Countdown done, play GO beep and start exercise
            if (lastBeepRef.current !== 0) {
              playStartBeep();
              lastBeepRef.current = 0;
            }
            setPhase('exercise');
            setExerciseElapsed(0);
            return 3; // Reset for next time
          }
          return newValue;
        });
      } else {
        setTotalElapsed((t) => t + 1);
        if (phase === 'exercise') {
          setExerciseElapsed((t) => {
            const newElapsed = t + 1;
            // Play tick sound every second during exercise (but not during last 3 seconds)
            if (newElapsed > 0) {
              playTick();
            }
            return newElapsed;
          });
        } else if (phase === 'rest') {
          setRestCountdown((t) => {
            const newCountdown = t - 1;

            // Play countdown beeps at 3, 2, 1 seconds
            if (newCountdown <= 3 && newCountdown > 0 && newCountdown !== lastBeepRef.current) {
              playCountdownBeep();
              lastBeepRef.current = newCountdown;
            }

            if (newCountdown <= 0) {
              // Rest done, play GO beep and move to next exercise
              if (lastBeepRef.current !== 0) {
                playStartBeep();
                lastBeepRef.current = 0;
              }
              goToNextExercise();
              return 0;
            }
            return newCountdown;
          });
        }
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [phase, isPaused]);

  // Play audio during countdown (intro + first exercise) or rest (next exercise)
  // This matches HIIT behavior where audio plays before the exercise starts
  useEffect(() => {
    let audioKey = null;
    let audioUrl = null;

    if (phase === 'countdown') {
      // Play intro audio first, then first exercise audio
      if (program?.intro_audio_url && lastAudioPlayedRef.current !== 'intro') {
        audioKey = 'intro';
        audioUrl = program.intro_audio_url;
      } else if (exercises[0]?.audio_url && lastAudioPlayedRef.current !== 'countdown-0') {
        audioKey = 'countdown-0';
        audioUrl = exercises[0].audio_url;
      }
    } else if (phase === 'rest') {
      // Get the NEXT exercise (the one that will start after this rest)
      const nextIdx = currentExerciseIdx + 1;
      const nextExercise = nextIdx >= exercises.length ? exercises[0] : exercises[nextIdx];
      audioKey = `rest-${currentExerciseIdx}-${round}`;
      audioUrl = nextExercise?.audio_url;
    }

    if (audioUrl && audioKey && lastAudioPlayedRef.current !== audioKey) {
      try {
        const player = voicePlayerRef.current || new Audio();
        player.src = audioUrl;
        player.currentTime = 0;
        voicePlayerRef.current = player;
        player.play().catch((err) => console.log('Audio play failed:', err));
        lastAudioPlayedRef.current = audioKey;
      } catch (err) {
        console.log('Audio playback error:', err);
      }
    }
  }, [phase, currentExerciseIdx, round, exercises, program]);

  function startWorkout() {
    // Wake up audio on user gesture (required for iOS/mobile)
    wakeAudio();

    setPhase('countdown');
    setCountdownValue(3);
    lastBeepRef.current = -1;
    lastAudioPlayedRef.current = null;
  }

  function markExerciseDone() {
    // Save time for this exercise
    setExerciseTimes((prev) => [
      ...prev,
      {
        exercise: currentExercise.title,
        round,
        seconds: exerciseElapsed,
        reps: currentExercise.reps,
      },
    ]);

    // Start rest phase
    setRestCountdown(restSeconds);
    setPhase('rest');
  }

  const goToNextExercise = useCallback(() => {
    const nextIdx = currentExerciseIdx + 1;
    if (nextIdx >= exercises.length) {
      // Completed a round
      setRound((r) => r + 1);
      setCurrentExerciseIdx(0);
    } else {
      setCurrentExerciseIdx(nextIdx);
    }
    setExerciseElapsed(0);
    setPhase('exercise');
  }, [currentExerciseIdx, exercises.length]);

  function finishWorkout() {
    setPhase('done');
    if (onComplete) {
      onComplete({
        circuitProgramId: program?.id,
        title: program?.title || 'Circuit',
        roundsCompleted: round - 1 + (currentExerciseIdx > 0 ? 1 : 0),
        totalSeconds: totalElapsed,
        exerciseTimes,
      });
    }
  }

  function togglePause() {
    setIsPaused((p) => !p);
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Calculate stats
  const completedReps = exerciseTimes.reduce((sum, et) => sum + (et.reps || 0), 0);
  const avgTimePerExercise = exerciseTimes.length > 0
    ? Math.round(exerciseTimes.reduce((sum, et) => sum + et.seconds, 0) / exerciseTimes.length)
    : 0;

  if (phase === 'ready') {
    return (
      <div className="circuit-timer ready-phase">
        <h2>{program?.title || 'Circuit'}</h2>
        <p className="circuit-description">{program?.description}</p>
        <div className="circuit-preview">
          {exercises.map((ex, idx) => (
            <div key={idx} className="preview-exercise">
              <span className="preview-reps">{ex.reps}</span>
              <span className="preview-title">{ex.title}</span>
            </div>
          ))}
        </div>
        <p className="rest-info">Paus mellan övningar: {restSeconds}s</p>
        <button className="primary large start-btn" onClick={startWorkout}>
          ▶ Starta Circuit
        </button>
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="circuit-timer countdown-phase">
        <div className="countdown-display">
          <p className="phase-label">GÖR DIG REDO</p>
          <div className="countdown-number">{countdownValue}</div>
          <p className="next-up">Första övningen: {currentExercise?.title}</p>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="circuit-timer done-phase">
        <h2>🎉 Bra jobbat!</h2>
        <div className="final-stats">
          <div className="stat">
            <span className="stat-value">{round - 1}</span>
            <span className="stat-label">Varv</span>
          </div>
          <div className="stat">
            <span className="stat-value">{formatTime(totalElapsed)}</span>
            <span className="stat-label">Total tid</span>
          </div>
          <div className="stat">
            <span className="stat-value">{completedReps}</span>
            <span className="stat-label">Reps</span>
          </div>
        </div>
      </div>
    );
  }

  // Active phase (exercise or rest)
  return (
    <div className={`circuit-timer ${phase}-phase ${isPaused ? 'paused' : ''}`}>
      {/* Stats bar */}
      <div className="circuit-stats-bar">
        <div className="stat-item reps-stat">
          <span className="stat-label">Reps</span>
          <span className="stat-value">{completedReps}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Varv</span>
          <span className="stat-value">{round}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Tid</span>
          <span className="stat-value">{formatTime(totalElapsed)}</span>
        </div>
      </div>

      {phase === 'rest' ? (
        /* Rest phase */
        <div className="rest-display">
          <p className="phase-label">PAUS</p>
          <div className="rest-countdown">{restCountdown}</div>
          <p className="next-up">Nästa: {exercises[(currentExerciseIdx + 1) % exercises.length]?.title}</p>
        </div>
      ) : (
        /* Exercise phase */
        <div className="exercise-display">
          <p className="phase-label">GÖR NU</p>
          <div className="exercise-reps">{currentExercise?.reps}</div>
          <div className="exercise-name">{currentExercise?.title}</div>
          {currentExercise?.notes && <p className="exercise-notes">{currentExercise.notes}</p>}
          <div className="exercise-timer">{formatTime(exerciseElapsed)}</div>
          <button className="primary large done-btn" onClick={markExerciseDone}>
            ✓ Klar!
          </button>
        </div>
      )}

      {/* Progress indicator */}
      <div className="exercise-progress">
        {exercises.map((ex, idx) => (
          <div
            key={idx}
            className={`progress-dot ${idx === currentExerciseIdx ? 'current' : ''} ${idx < currentExerciseIdx ? 'done' : ''}`}
            title={ex.title}
          />
        ))}
      </div>

      {/* Control buttons */}
      <div className="circuit-controls">
        <button className="ghost" onClick={togglePause}>
          {isPaused ? '▶ Fortsätt' : '⏸ Pausa'}
        </button>
        <button className="ghost danger" onClick={finishWorkout}>
          ⏹ Avsluta
        </button>
      </div>
    </div>
  );
}

export default CircuitTimer;

