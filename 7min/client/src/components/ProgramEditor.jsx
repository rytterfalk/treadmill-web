import { useEffect, useMemo, useState } from 'react';

const starterExercises = [
  { title: 'Knäböj', durationSeconds: 30, restSeconds: 10, notes: '' },
  { title: 'Armhävningar', durationSeconds: 30, restSeconds: 10, notes: '' },
];

function ProgramEditor({ prefill, onSave }) {
  const [title, setTitle] = useState('Snabbpass');
  const [description, setDescription] = useState('Byggt i editorn');
  const [rounds, setRounds] = useState(2);
  const [isPublic, setIsPublic] = useState(false);
  const [exercises, setExercises] = useState(starterExercises);
  const [draggingIdx, setDraggingIdx] = useState(null);

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
          }))
        : starterExercises
    );
  }, [prefillKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateExercise(index, field, value) {
    setExercises((list) =>
      list.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  }

  function addExercise() {
    setExercises((list) => [
      ...list,
      { title: 'Nytt moment', durationSeconds: 30, restSeconds: 10, notes: '' },
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
      exercises,
    });
  }

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
      </form>
    </div>
  );
}

export default ProgramEditor;
