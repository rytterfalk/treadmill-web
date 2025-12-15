const ICONS = {
  shoe: '👟',
  dumbbell: '🏋️',
  bolt: '⚡️',
  beaker: '🧪',
  dot: '•',
};

function WeekBars({ days, cap }) {
  if (!days?.length) return <p>Ingen data ännu.</p>;

  const hasData = days.some((d) => (d?.points || 0) > 0 || d?.hitCap);
  if (!hasData) {
    return <p>Ingen data ännu.</p>;
  }

  return (
    <div className="weekbars">
      {days.map((day) => {
        const percent = cap ? Math.min(100, Math.round((day.points / cap) * 100)) : 0;
        return (
          <div key={day.date} className="weekbar-day" title={`${day.date} • ${day.points}p`}>
            <div
              className={`bar ${day.hitCap ? 'cap' : ''}`}
              style={{ height: `${Math.max(8, percent)}%` }}
            />
            <div className="bar-date">
              {new Date(day.date).toLocaleDateString('sv-SE', { weekday: 'short' })}
            </div>
          </div>
        );
      })}
      <div className="weekbar-legend">
        <span className="dot blue" /> Points (cap {cap})
        <span className="dot cap" /> Cap träffad
      </div>
      <div className="weekbar-legend">
        Ikoner: {Object.entries(ICONS).map(([key, icon]) => (
          <span key={key} className="legend-icon">
            {icon} {key}
          </span>
        ))}
      </div>
    </div>
  );
}

export default WeekBars;
