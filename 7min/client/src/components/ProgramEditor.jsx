import { useEffect, useMemo, useRef, useState } from 'react';

const starterExercises = [
  { title: 'Knäböj', durationSeconds: 30, restSeconds: 10, notes: '', audioAssetId: null, audioUrl: null },
  { title: 'Armhävningar', durationSeconds: 30, restSeconds: 10, notes: '', audioAssetId: null, audioUrl: null },
];

function ProgramEditor({ prefill, onSave }) {
  const [title, setTitle] = useState('Snabbpass');
  const [description, setDescription] = useState('Byggt i editorn');
  const [rounds, setRounds] = useState(2);
  const [isPublic, setIsPublic] = useState(false);
  const [exercises, setExercises] = useState(starterExercises);
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
    setTitle(`${prefill.program?.title || 'Nytt pass'} (kopia)`);
    setDescription(prefill.program?.description || '');
    setRounds(prefill.program?.rounds || 1);
    setIsPublic(!!prefill.program?.is_public);
    setExercises(
      prefill.exercises?.length
        ? prefill.exercises.map((ex) => ({
            title: ex.title,
            durationSeconds: ex.durationSeconds,
            restSeconds: ex.restSeconds,
            notes: ex.notes || '',
            audioAssetId: ex.audioAssetId || null,
            audioUrl: ex.audioUrl || null,
          }))
        : starterExercises
    );
  }, [prefillKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function setExercisePatch(index, patch) {
    setExercises((list) =>
      list.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  function updateExercise(index, field, value) {
    setExercisePatch(index, { [field]: value });
  }

  function addExercise() {
    setExercises((list) => [
      ...list,
      { title: 'Nytt moment', durationSeconds: 30, restSeconds: 10, notes: '', audioAssetId: null, audioUrl: null },
    ]);
  }

  function removeExercise(index) {
    setExercises((list) => list.filter((_, idx) => idx !== index));
  }

  function moveExercise(from, to) {
    setExercises((list) => {
      const boundedTarget = Math.max(0, Math.min(list.length - 1, to));
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(boundedTarget, 0, item);
      return next;
    });
  }

  function handleDragStart(index) {
    setDraggingIdx(index);
  }

  function handleDragOver(index) {
    if (draggingIdx === null || draggingIdx === index) return;
    setExercises((list) => {
      const updated = [...list];
      const [moved] = updated.splice(draggingIdx, 1);
      updated.splice(index, 0, moved);
      return updated;
    });
    setDraggingIdx(index);
  }

  function handleDragEnd() {
    setDraggingIdx(null);
  }

  function handleOrderInput(index, value) {
    if (Number.isNaN(value) || value < 1) return;
    const targetIndex = Math.max(0, Math.min(exercises.length - 1, value - 1));
    moveExercise(index, targetIndex);
    setDraggingIdx(targetIndex);
    setTimeout(() => setDraggingIdx(null), 120);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      title,
      description,
      rounds: Number(rounds) || 1,
      isPublic,
      exercises: exercises.map((ex) => ({
        title: ex.title,
        durationSeconds: ex.durationSeconds,
        restSeconds: ex.restSeconds,
        notes: ex.notes,
        audioAssetId: ex.audioAssetId || null,
      })),
    });
  }

  function stopStream() {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  async function startRecording(index) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Din browser blockerar inspelning.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        uploadAudio(index, blob);
        stopStream();
        setRecordingIdx(null);
      };
      recorder.start();
      setRecordingIdx(index);
    } catch (err) {
      setStatus('Kunde inte starta inspelning. Kolla mikrofon-behörigheter.');
    }
  }

  async function uploadAudio(index, blob) {
    if (!blob.size) return;
    setExercisePatch(index, { uploadingAudio: true });
    try {
      const form = new FormData();
      form.append('file', blob, 'pause.webm');
      form.append('type', 'audio');
      const res = await fetch('/api/media', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunde inte ladda upp ljudet');
      setExercisePatch(index, {
        audioAssetId: data.asset.id,
        audioUrl: data.asset.url,
        uploadingAudio: false,
      });
      setStatus('Ljud sparat!');
    } catch (err) {
      setExercisePatch(index, { uploadingAudio: false });
      setStatus(err.message);
    }
  }

  function clearAudio(index) {
    setExercisePatch(index, { audioAssetId: null, audioUrl: null, uploadingAudio: false });
  }

  useEffect(() => () => stopStream(), []);

  return (
    <div>
      <div className="panel-header">
        <div>
          <p className="eyebrow">Bygg</p>
          <h2>Skapa ett upplägg</h2>
        </div>
      </div>
      <form className="editor" onSubmit={handleSubmit}>
        <label>
          Titel
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Beskrivning
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Hur ska passet kännas? Vad är målet?"
          />
        </label>
        <div className="inline">
          <label>
            Varv
            <input
              type="number"
              min="1"
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Dela till andra konton
          </label>
        </div>

        <div className="exercise-list">
          {exercises.map((ex, idx) => (
            <div
              className={`exercise-row ${draggingIdx === idx ? 'dragging' : ''}`}
              key={idx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                handleDragOver(idx);
              }}
              onDragEnd={handleDragEnd}
            >
              <div className="index">{idx + 1}</div>
              <div className="fields">
                <input
                  value={ex.title}
                  onChange={(e) => updateExercise(idx, 'title', e.target.value)}
                  placeholder="Övning"
                />
                <div className="inline">
                  <label>
                    Tid (s)
                    <input
                      type="number"
                      value={ex.durationSeconds}
                      onChange={(e) => updateExercise(idx, 'durationSeconds', Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Vila (s)
                    <input
                      type="number"
                      value={ex.restSeconds}
                      onChange={(e) => updateExercise(idx, 'restSeconds', Number(e.target.value))}
                    />
                  </label>
                </div>
                <input
                  value={ex.notes}
                  onChange={(e) => updateExercise(idx, 'notes', e.target.value)}
                  placeholder="Tips / notes"
                />
                <div className="order-controls">
                  <label className="inline compact order-label">
                    Ordning
                    <select
                      className="order-input"
                      value={idx + 1}
                      onChange={(e) => handleOrderInput(idx, Number(e.target.value))}
                    >
                      {exercises.map((_, orderIdx) => (
                        <option key={orderIdx} value={orderIdx + 1}>
                          {orderIdx + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="order-buttons">
                    <button
                      type="button"
                      className="ghost tiny"
                      disabled={idx === 0}
                      onClick={() => moveExercise(idx, idx - 1)}
                    >
                      Upp
                    </button>
                    <button
                      type="button"
                      className="ghost tiny"
                      disabled={idx === exercises.length - 1}
                      onClick={() => moveExercise(idx, idx + 1)}
                      >
                        Ner
                      </button>
                    </div>
                  </div>
                  <div className="audio-controls">
                    <div className="audio-header">
                      <p className="mini-title">Paus-meddelande</p>
                      {ex.uploadingAudio && <span className="badge">Laddar upp...</span>}
                    </div>
                    <div className="audio-actions">
                      {recordingIdx === idx ? (
                        <button type="button" onClick={stopRecording} className="ghost tiny">
                          Stoppa inspelning
                        </button>
                      ) : (
                        <button type="button" onClick={() => startRecording(idx)} className="ghost tiny">
                          🎙️ Spela in
                        </button>
                      )}
                      {ex.audioAssetId && (
                        <button type="button" className="ghost tiny" onClick={() => clearAudio(idx)}>
                          Rensa ljud
                        </button>
                      )}
                    </div>
                    {ex.audioUrl && (
                      <audio controls src={ex.audioUrl} className="audio-player">
                        Din browser stöder inte uppspelning.
                      </audio>
                    )}
                  </div>
              </div>
              <button type="button" className="ghost" onClick={() => removeExercise(idx)}>
                Ta bort
              </button>
            </div>
          ))}
          <button type="button" onClick={addExercise} className="ghost">
            + Lägg till moment
          </button>
        </div>

        <button type="submit">Spara pass</button>
        {status && <div className="status">{status}</div>}
      </form>
    </div>
  );
}

export default ProgramEditor;
