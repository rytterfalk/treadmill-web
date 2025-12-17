import { useEffect, useMemo, useRef, useState } from 'react';

const starterExercises = [
  {
    title: 'Knäböj',
    durationSeconds: 30,
    restSeconds: 10,
    timePercent: 100,
    notes: '',
    audioAssetId: null,
    audioUrl: null,
    halfAudioAssetId: null,
    halfAudioUrl: null,
  },
  {
    title: 'Armhävningar',
    durationSeconds: 30,
    restSeconds: 10,
    timePercent: 100,
    notes: '',
    audioAssetId: null,
    audioUrl: null,
    halfAudioAssetId: null,
    halfAudioUrl: null,
  },
];

const TIME_PERCENT_OPTIONS = [
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
  { value: 150, label: '150%' },
  { value: 200, label: '200%' },
];

function ProgramEditor({ prefill, onSave }) {
  const [title, setTitle] = useState('Snabbpass');
  const [description, setDescription] = useState('Byggt i editorn');
  const [rounds, setRounds] = useState(2);
  const [isPublic, setIsPublic] = useState(false);
  const [exercises, setExercises] = useState(starterExercises);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [recordingIdx, setRecordingIdx] = useState(null); // "pause-0" | "half-0" | null
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
    setRounds(1);
    setIsPublic(!!prefill.program?.is_public);
    setExercises(
      prefill.exercises?.length
        ? prefill.exercises.map((ex) => ({
            title: ex.title,
            durationSeconds: ex.durationSeconds,
            restSeconds: ex.restSeconds,
            timePercent: ex.timePercent || 100,
            notes: ex.notes || '',
            audioAssetId: ex.audioAssetId || null,
            audioUrl: ex.audioUrl || null,
            halfAudioAssetId: ex.halfAudioAssetId || null,
            halfAudioUrl: ex.halfAudioUrl || null,
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
      {
        title: 'Nytt moment',
        durationSeconds: 30,
        restSeconds: 10,
        timePercent: 100,
        notes: '',
        audioAssetId: null,
        audioUrl: null,
        halfAudioAssetId: null,
        halfAudioUrl: null,
      },
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
      rounds: 1,
      isPublic,
      exercises: exercises.map((ex) => ({
        title: ex.title,
        durationSeconds: Math.round((ex.durationSeconds || 30) * ((ex.timePercent || 100) / 100)),
        restSeconds: 10,
        timePercent: ex.timePercent || 100,
        notes: ex.notes,
        audioAssetId: ex.audioAssetId || null,
        halfAudioAssetId: ex.halfAudioAssetId || null,
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

  const preferredMimeTypes = ['audio/mp4;codecs=aac', 'audio/webm;codecs=opus', 'audio/ogg'];

  function pickSupportedMime() {
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) {
      return { mimeType: 'audio/webm' };
    }
    for (const t of preferredMimeTypes) {
      if (MediaRecorder.isTypeSupported(t)) return { mimeType: t };
    }
    return { mimeType: 'audio/webm' };
  }

  async function startRecording(index, { half = false } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Din browser saknar stöd eller blockerar inspelning.');
      return;
    }
    const isSecure =
      window.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
    if (!isSecure) {
      setStatus('Inspelning kräver HTTPS eller localhost. Lägg gärna till cert eller kör via https://.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, pickSupportedMime());
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        uploadAudio(index, blob, { half });
        stopStream();
        setRecordingIdx(null);
      };
      recorder.start();
      setRecordingIdx(`${half ? 'half-' : 'pause-'}${index}`);
    } catch (err) {
      const hint =
        err?.name === 'NotAllowedError'
          ? 'Mikrofon-tillstånd nekades. Tillåt mic för sajten och försök igen.'
          : err?.name === 'NotFoundError'
            ? 'Ingen mikrofon hittades.'
            : 'Kunde inte starta inspelning. Kolla mikrofon-behörigheter.';
      setStatus(hint);
    }
  }

  function guessExtension(mime) {
    if (!mime) return '.webm';
    const t = mime.toLowerCase();
    if (t.includes('mp4') || t.includes('aac')) return '.m4a';
    if (t.includes('ogg')) return '.ogg';
    if (t.includes('wav')) return '.wav';
    return '.webm';
  }

  async function uploadAudio(index, blob, { half = false } = {}) {
    if (!blob.size) return;
    setExercisePatch(index, { uploadingAudio: true });
    try {
      const mime = blob.type || 'audio/webm';
      const ext = guessExtension(mime);
      const fileName = half ? `halftime${ext}` : `pause${ext}`;
      const file = new File([blob], fileName, { type: mime });

      const form = new FormData();
      form.append('file', file, fileName);
      form.append('type', 'audio');
      const res = await fetch('/api/media', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunde inte ladda upp ljudet');
      if (half) {
        setExercisePatch(index, {
          halfAudioAssetId: data.asset.id,
          halfAudioUrl: data.asset.url,
          halfAudioMime: mime,
          uploadingAudio: false,
        });
        setStatus('Halvtidsljud sparat!');
      } else {
        setExercisePatch(index, {
          audioAssetId: data.asset.id,
          audioUrl: data.asset.url,
          audioMime: mime,
          uploadingAudio: false,
        });
        setStatus('Ljud sparat!');
      }
    } catch (err) {
      setExercisePatch(index, { uploadingAudio: false });
      setStatus(err.message);
    }
  }

  function clearAudio(index, { half = false } = {}) {
    if (half) {
      setExercisePatch(index, {
        halfAudioAssetId: null,
        halfAudioUrl: null,
        halfAudioMime: null,
        uploadingAudio: false,
      });
      return;
    }
    setExercisePatch(index, {
      audioAssetId: null,
      audioUrl: null,
      audioMime: null,
      uploadingAudio: false,
    });
  }

  useEffect(() => () => stopStream(), []);

  return (
    <div className="program-editor">
      <div className="editor-header">
        <h2>{prefill ? 'Redigera pass' : 'Skapa nytt pass'}</h2>
      </div>

      <form className="editor-form" onSubmit={handleSubmit}>
        {/* Program Settings */}
        <div className="editor-section">
          <div className="editor-row">
            <label className="editor-field">
              <span className="field-label">Titel</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Ge ditt pass ett namn" />
            </label>
          </div>

          <div className="editor-row">
            <label className="editor-field">
              <span className="field-label">Beskrivning</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Beskriv passet kort..."
              />
            </label>
          </div>

          <div className="editor-row checkbox-row">
            <label className="editor-checkbox">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              <span>Dela med andra</span>
            </label>
          </div>
        </div>

        {/* Exercises */}
        <div className="editor-section">
          <div className="section-header">
            <h3>Övningar</h3>
            <span className="exercise-count">{exercises.length} moment</span>
          </div>

          <div className="exercise-list-editor">
            {exercises.map((ex, idx) => (
              <div
                className={`exercise-card ${draggingIdx === idx ? 'dragging' : ''}`}
                key={idx}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => { e.preventDefault(); handleDragOver(idx); }}
                onDragEnd={handleDragEnd}
              >
                <div className="exercise-card-header">
                  <div className="exercise-number">{idx + 1}</div>
                  <input
                    className="exercise-title-input"
                    value={ex.title}
                    onChange={(e) => updateExercise(idx, 'title', e.target.value)}
                    placeholder="Namn på övning"
                  />
                  <button type="button" className="remove-btn" onClick={() => removeExercise(idx)} aria-label="Ta bort">
                    ×
                  </button>
                </div>

                <div className="exercise-card-body">
                  <div className="exercise-settings">
                    <label className="setting-field">
                      <span>Tid</span>
                      <select
                        value={ex.timePercent || 100}
                        onChange={(e) => updateExercise(idx, 'timePercent', Number(e.target.value))}
                      >
                        {TIME_PERCENT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>

                    <div className="order-btns">
                      <button type="button" className="ghost tiny" disabled={idx === 0} onClick={() => moveExercise(idx, idx - 1)}>↑</button>
                      <button type="button" className="ghost tiny" disabled={idx === exercises.length - 1} onClick={() => moveExercise(idx, idx + 1)}>↓</button>
                    </div>
                  </div>

                  <input
                    className="notes-input"
                    value={ex.notes}
                    onChange={(e) => updateExercise(idx, 'notes', e.target.value)}
                    placeholder="Tips / instruktioner (valfritt)"
                  />

                  {/* Audio Controls - Collapsed */}
                  <details className="audio-details">
                    <summary>🎙️ Ljudinspelningar</summary>
                    <div className="audio-controls-inner">
                      <div className="audio-row">
                        <span className="audio-label">Paus-meddelande</span>
                        {ex.uploadingAudio && <span className="badge small">Laddar...</span>}
                        <div className="audio-btns">
                          {recordingIdx === `pause-${idx}` ? (
                            <button type="button" onClick={stopRecording} className="ghost tiny recording">⏹ Stoppa</button>
                          ) : (
                            <button type="button" onClick={() => startRecording(idx)} className="ghost tiny">● Spela in</button>
                          )}
                          {ex.audioAssetId && <button type="button" className="ghost tiny" onClick={() => clearAudio(idx)}>Rensa</button>}
                        </div>
                      </div>
                      {ex.audioUrl && (
                        <audio controls src={`${ex.audioUrl}?v=${Date.now()}`} className="audio-preview" preload="auto" type={ex.audioMime || undefined} />
                      )}

                      <div className="audio-row">
                        <span className="audio-label">Halvtidsljud</span>
                        <div className="audio-btns">
                          {recordingIdx === `half-${idx}` ? (
                            <button type="button" onClick={stopRecording} className="ghost tiny recording">⏹ Stoppa</button>
                          ) : (
                            <button type="button" onClick={() => startRecording(idx, { half: true })} className="ghost tiny">● Spela in</button>
                          )}
                          {ex.halfAudioAssetId && <button type="button" className="ghost tiny" onClick={() => clearAudio(idx, { half: true })}>Rensa</button>}
                        </div>
                      </div>
                      {ex.halfAudioUrl && (
                        <audio controls src={`${ex.halfAudioUrl}?v=${Date.now()}`} className="audio-preview" preload="auto" type={ex.halfAudioMime || undefined} />
                      )}
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addExercise} className="add-exercise-btn">
            + Lägg till övning
          </button>
        </div>

        <div className="editor-actions">
          <button type="submit" className="save-btn">Spara pass</button>
        </div>

        {status && <div className="editor-status">{status}</div>}
      </form>
    </div>
  );
}

export default ProgramEditor;
