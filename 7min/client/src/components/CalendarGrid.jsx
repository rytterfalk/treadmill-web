const ICONS = {
  shoe: '👟',
  dumbbell: '🏋️',
  bolt: '⚡️',
  beaker: '🧪',
  dot: '•',
};

function CalendarGrid({ days, selectedDate, onSelect }) {
  if (!days?.length) return <p>Ingen data för intervallet.</p>;

  return (
    <div className="calendar-grid">
      {days.map((day) => {
        const isSelected = selectedDate === day.date;
        return (
        <button
          key={day.date}
          className={`calendar-day ${isSelected ? 'active' : ''}`}
          type="button"
          onClick={() => onSelect(day.date)}
        >
            <div className="calendar-date">
              <span className="day-number">{day.date.slice(8, 10)}</span>
              <span className="weekday">
                {new Date(day.date).toLocaleDateString('sv-SE', { weekday: 'short' })}
              </span>
            </div>
            <div className="calendar-icons">
              {day.icons?.length
                ? day.icons.map((icon) => (
                    <span key={icon} className="icon">
                      {ICONS[icon] || '•'}
                    </span>
                  ))
                : '—'}
            </div>
            <div className="calendar-meta">
              <span>{day.minutes} min</span>
              <span>{day.points}p</span>
            </div>
            {day.hitCap && <span className="cap-flag">Cap</span>}
          </button>
        );
      })}
    </div>
  );
}

export default CalendarGrid;
