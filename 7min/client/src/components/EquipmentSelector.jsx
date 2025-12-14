import { useEffect, useState } from 'react';

function EquipmentSelector({ allEquipment, selected, onSave }) {
  const [localSelection, setLocalSelection] = useState(selected || []);

  useEffect(() => {
    setLocalSelection(selected || []);
  }, [selected]);

  function toggle(slug) {
    setLocalSelection((prev) =>
      prev.includes(slug) ? prev.filter((item) => item !== slug) : [...prev, slug]
    );
  }

  function handleSave(e) {
    e.preventDefault();
    onSave(localSelection);
  }

  return (
    <div>
      <div className="panel-header">
        <div>
          <p className="eyebrow">Utrustning</p>
          <h2>Vad har du hemma?</h2>
        </div>
      </div>
      <form className="equipment" onSubmit={handleSave}>
        <div className="chip-grid">
          {allEquipment.map((item) => (
            <button
              key={item.slug}
              type="button"
              className={localSelection.includes(item.slug) ? 'chip active' : 'chip'}
              onClick={() => toggle(item.slug)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <button type="submit">Spara utrustning</button>
      </form>
    </div>
  );
}

export default EquipmentSelector;
