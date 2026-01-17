import { useCallback, useEffect, useRef, useState } from 'react';

function CircuitTimer({ program, exercises, onComplete }) {
  const [phase, setPhase] = useState('ready'); // ready | exercise | rest | done
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);
  const [round, setRound] = useState(1);
  const [restCountdown, setRestCountdown] = useState(0);
  const [exerciseElapsed, setExerciseElapsed] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [exerciseTimes, setExerciseTimes] = useState([]); // Array of { exercise, round, seconds }
  const [isPaused, setIsPaused] = useState(false);

  const intervalRef = useRef(null);
  const exerciseAudioRef = useRef(null);
  const restAudioRef = useRef(null);

  const currentExercise = exercises[currentExerciseIdx];
  const restSeconds = program?.rest_seconds || 30;

  // Timer tick
  useEffect(() => {
    if (phase === 'ready' || phase === 'done' || isPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setTotalElapsed((t) => t + 1);
      if (phase === 'exercise') {
        setExerciseElapsed((t) => t + 1);
      } else if (phase === 'rest') {
        setRestCountdown((t) => {
          if (t <= 1) {
            // Rest done, move to next exercise
            goToNextExercise();
            return 0;
          }
          return t - 1;
        });
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [phase, isPaused]);

  // Play audio when exercise starts
  useEffect(() => {
    if (phase === 'exercise' && currentExercise?.audio_url && exerciseAudioRef.current) {
      const audio = exerciseAudioRef.current;
      audio.load();
      audio.play().catch((err) => console.log('Audio play failed:', err));
    }
  }, [phase, currentExerciseIdx]);

  // Play audio when rest starts
  useEffect(() => {
    if (phase === 'rest' && currentExercise?.rest_audio_url && restAudioRef.current) {
      const audio = restAudioRef.current;
      audio.load();
      audio.play().catch((err) => console.log('Rest audio play failed:', err));
    }
  }, [phase, currentExerciseIdx]);

  function startWorkout() {
    setPhase('exercise');
    setExerciseElapsed(0);
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
      {/* Hidden audio elements - always render, update src dynamically */}
      <audio
        ref={exerciseAudioRef}
        src={currentExercise?.audio_url || ''}
        preload="auto"
        style={{ display: 'none' }}
      />
      <audio
        ref={restAudioRef}
        src={currentExercise?.rest_audio_url || ''}
        preload="auto"
        style={{ display: 'none' }}
      />

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

