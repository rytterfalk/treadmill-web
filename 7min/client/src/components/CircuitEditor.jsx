import { useEffect, useMemo, useRef, useState } from 'react';

const starterExercises = [
  { title: 'Pullups', reps: 6, notes: '', audioAssetId: null, audioUrl: null, restAudioAssetId: null, restAudioUrl: null },
  { title: 'Armhävningar', reps: 12, notes: '', audioAssetId: null, audioUrl: null, restAudioAssetId: null, restAudioUrl: null },
  { title: 'Knäböj', reps: 10, notes: '', audioAssetId: null, audioUrl: null, restAudioAssetId: null, restAudioUrl: null },
];

function CircuitEditor({ prefill, onSave, onCancel }) {
  const [title, setTitle] = useState('Mitt circuit');
  const [description, setDescription] = useState('');
  const [restSeconds, setRestSeconds] = useState(30);
  const [isPublic, setIsPublic] = useState(false);
  const [exercises, setExercises] = useState(starterExercises);
  const [introAudioAssetId, setIntroAudioAssetId] = useState(null);
  const [introAudioUrl, setIntroAudioUrl] = useState(null);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [recordingIdx, setRecordingIdx] = useState(null);
  const [status, setStatus] = useState('');
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);

  const prefillKey = useMemo(
    () => (prefill ? `${prefill.program?.id}-${prefill.exercises?.length}` : ''),
    [prefill]
  );

  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.program?.title || 'Mitt circuit');
    setDescription(prefill.program?.description || '');
    setRestSeconds(prefill.program?.rest_seconds || 30);
    setIsPublic(!!prefill.program?.is_public);
    setIntroAudioAssetId(prefill.program?.intro_audio_asset_id || null);
    setIntroAudioUrl(prefill.program?.intro_audio_url || null);
    setExercises(
      prefill.exercises?.length
        ? prefill.exercises.map((ex) => ({
            title: ex.title,
            reps: ex.reps || 10,
            notes: ex.notes || '',
            audioAssetId: ex.audio_asset_id || null,
            audioUrl: ex.audio_url || null,
            restAudioAssetId: ex.rest_audio_asset_id || null,
            restAudioUrl: ex.rest_audio_url || null,
          }))
        : starterExercises
    );
  }, [prefillKey]);

  function updateExercise(index, field, value) {
    setExercises((list) =>
      list.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  }

  function addExercise() {
    setExercises((list) => [
      ...list,
      { title: 'Ny övning', reps: 10, notes: '', audioAssetId: null, audioUrl: null, restAudioAssetId: null, restAudioUrl: null },
    ]);
  }

  function removeExercise(index) {
    setExercises((list) => list.filter((_, idx) => idx !== index));
  }

  function moveExercise(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= exercises.length) return;
    setExercises((list) => {
      const copy = [...list];
      const [item] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, item);
      return copy;
    });
  }

  // Audio recording
  async function startRecording(type, index = null) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await uploadAudio(blob, type, index);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingIdx(index !== null ? `${type}-${index}` : type);
      setStatus('Spelar in...');
    } catch (err) {
      setStatus('Kunde inte starta inspelning: ' + err.message);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecordingIdx(null);
    setStatus('Sparar ljud...');
  }

  async function uploadAudio(blob, type, index = null) {
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('type', 'audio');
    try {
      const res = await fetch('/api/assets', { method: 'POST', body: formData, credentials: 'include' });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (type === 'intro') {
        setIntroAudioAssetId(data.asset.id);
        setIntroAudioUrl(data.asset.url);
      } else if (type === 'exercise') {
        updateExercise(index, 'audioAssetId', data.asset.id);
        updateExercise(index, 'audioUrl', data.asset.url);
      } else {
        updateExercise(index, 'restAudioAssetId', data.asset.id);
        updateExercise(index, 'restAudioUrl', data.asset.url);
      }
      setStatus('Ljud sparat!');
    } catch (err) {
      setStatus('Kunde inte ladda upp ljud: ' + err.message);
    }
  }

  function clearAudio(index, type) {
    if (type === 'intro') {
      setIntroAudioAssetId(null);
      setIntroAudioUrl(null);
    } else if (type === 'exercise') {
      updateExercise(index, 'audioAssetId', null);
      updateExercise(index, 'audioUrl', null);
    } else {
      updateExercise(index, 'restAudioAssetId', null);
      updateExercise(index, 'restAudioUrl', null);
    }
    setStatus('Ljud borttaget');
  }

  function handleSave() {
    if (!title.trim()) {
      setStatus('Ange en titel');
      return;
    }
    if (exercises.length === 0) {
      setStatus('Lägg till minst en övning');
      return;
    }
    onSave({
      title: title.trim(),
      description: description.trim(),
      restSeconds,
      isPublic,
      introAudioAssetId,
      exercises: exercises.map((ex) => ({
        title: ex.title,
        reps: ex.reps,
        notes: ex.notes,
        audioAssetId: ex.audioAssetId,
        restAudioAssetId: ex.restAudioAssetId,
      })),
    });
  }

  const totalReps = exercises.reduce((sum, ex) => sum + (ex.reps || 0), 0);

  return (
    <div className="circuit-editor">
      <div className="editor-header">
        <h2>Circuit-pass</h2>
        <p className="subtle">Skapa ett rep-baserat träningspass</p>
      </div>

      {status && <div className="status-banner">{status}</div>}

      <div className="editor-form">
        <div className="form-row">
          <label>Titel</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="T.ex. Pullup-circuit"
          />
        </div>

        <div className="form-row">
          <label>Beskrivning (valfritt)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beskriv passet..."
            rows={2}
          />
        </div>

        <div className="form-row-inline">
          <div className="form-row">
            <label>Paus mellan övningar</label>
            <div className="input-with-unit">
              <input
                type="number"
                value={restSeconds}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setRestSeconds('');
                  } else {
                    setRestSeconds(Number(val));
                  }
                }}
                onBlur={() => {
                  if (restSeconds === '' || restSeconds < 5) {
                    setRestSeconds(30);
                  }
                }}
                min={5}
                max={300}
              />
              <span>sek</span>
            </div>
          </div>
          <div className="form-row">
            <label>Synlighet</label>
            <select value={isPublic ? 'public' : 'private'} onChange={(e) => setIsPublic(e.target.value === 'public')}>
              <option value="private">Privat</option>
              <option value="public">Delad</option>
            </select>
          </div>
        </div>
      </div>

      {/* Intro Audio Section */}
      <div className="editor-section">
        <h3>🎙️ Introduktionsljud</h3>
        <p className="section-hint">Spelas innan träningspasset startar (under nedräkningen)</p>
        <div className="audio-control">
          <div className="audio-btns">
            {recordingIdx === 'intro' ? (
              <button className="ghost tiny recording" onClick={stopRecording}>⏹ Stoppa</button>
            ) : (
              <button className="ghost tiny" onClick={() => startRecording('intro')}>● Spela in</button>
            )}
            {introAudioUrl && (
              <button className="ghost tiny" onClick={() => clearAudio(null, 'intro')}>Rensa</button>
            )}
          </div>
          {introAudioUrl && (
            <audio src={`${introAudioUrl}?v=${Date.now()}`} controls className="audio-preview" preload="auto" />
          )}
        </div>
      </div>

      <div className="exercise-list-header">
        <h3>Övningar</h3>
        <span className="badge">{exercises.length} st • {totalReps} reps/varv</span>
      </div>

      <div className="exercise-list">
        {exercises.map((ex, idx) => (
          <div
            key={idx}
            className={`exercise-card ${draggingIdx === idx ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDraggingIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { moveExercise(draggingIdx, idx); setDraggingIdx(null); }}
            onDragEnd={() => setDraggingIdx(null)}
          >
            <div className="exercise-drag-handle">⋮⋮</div>
            <div className="exercise-main">
              <input
                type="text"
                className="exercise-title-input"
                value={ex.title}
                onChange={(e) => updateExercise(idx, 'title', e.target.value)}
                placeholder="Övningsnamn"
              />
              <div className="exercise-row">
                <div className="reps-input">
                  <input
                    type="number"
                    value={ex.reps}
                    onChange={(e) => updateExercise(idx, 'reps', Math.max(1, Number(e.target.value) || 1))}
                    min={1}
                  />
                  <span>reps</span>
                </div>
                <input
                  type="text"
                  className="exercise-notes"
                  value={ex.notes}
                  onChange={(e) => updateExercise(idx, 'notes', e.target.value)}
                  placeholder="Anteckningar..."
                />
              </div>
              <div className="audio-controls">
                <div className="audio-control">
                  <span className="audio-label">🎤 Förberedelseljud</span>
                  <span className="audio-hint">(spelas innan övningen)</span>
                  <div className="audio-btns">
                    {recordingIdx === `exercise-${idx}` ? (
                      <button className="ghost tiny recording" onClick={stopRecording}>⏹ Stoppa</button>
                    ) : (
                      <button className="ghost tiny" onClick={() => startRecording('exercise', idx)}>● Spela in</button>
                    )}
                    {ex.audioUrl && (
                      <button className="ghost tiny" onClick={() => clearAudio(idx, 'exercise')}>Rensa</button>
                    )}
                  </div>
                  {ex.audioUrl && (
                    <audio src={`${ex.audioUrl}?v=${Date.now()}`} controls className="audio-preview" preload="auto" />
                  )}
                </div>
                <div className="audio-control">
                  <span className="audio-label">🔔 Pausmeddelande</span>
                  <span className="audio-hint">(spelas under pausen)</span>
                  <div className="audio-btns">
                    {recordingIdx === `rest-${idx}` ? (
                      <button className="ghost tiny recording" onClick={stopRecording}>⏹ Stoppa</button>
                    ) : (
                      <button className="ghost tiny" onClick={() => startRecording('rest', idx)}>● Spela in</button>
                    )}
                    {ex.restAudioUrl && (
                      <button className="ghost tiny" onClick={() => clearAudio(idx, 'rest')}>Rensa</button>
                    )}
                  </div>
                  {ex.restAudioUrl && (
                    <audio src={`${ex.restAudioUrl}?v=${Date.now()}`} controls className="audio-preview" preload="auto" />
                  )}
                </div>
              </div>
            </div>
            <button className="remove-btn" onClick={() => removeExercise(idx)} title="Ta bort">✕</button>
          </div>
        ))}
      </div>

      <button className="ghost add-exercise-btn" onClick={addExercise}>
        + Lägg till övning
      </button>

      <div className="editor-actions">
        <button className="ghost" onClick={onCancel}>Avbryt</button>
        <button className="primary" onClick={handleSave}>Spara circuit</button>
      </div>
    </div>
  );
}

export default CircuitEditor;

