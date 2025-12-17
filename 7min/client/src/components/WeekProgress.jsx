const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

function WeekProgress({ days, cap = 60, selectedDate, onSelectDate }) {
  // Get current week (Mon-Sun)
  const today = new Date();
  const currentDayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + mondayOffset + i);
    const dateStr = date.toISOString().slice(0, 10);
    const dayData = days?.find(d => d.date === dateStr);
    weekDays.push({
      date: dateStr,
      weekday: WEEKDAYS[i],
      points: dayData?.points || 0,
      hitCap: dayData?.hitCap || false,
      isToday: dateStr === today.toISOString().slice(0, 10),
      isPast: date < new Date(today.toISOString().slice(0, 10)),
      isSelected: dateStr === selectedDate,
    });
  }

  const weekTotal = weekDays.reduce((sum, d) => sum + d.points, 0);
  const weekGoal = cap * 7;
  const weekPercent = Math.min(100, Math.round((weekTotal / weekGoal) * 100));

  return (
    <div className="week-progress">
      <div className="week-summary">
        <div className="week-total">
          <span className="points">{weekTotal}</span>
          <span className="label">/ {weekGoal} poäng</span>
        </div>
        <div className="week-bar-outer">
          <div className="week-bar-inner" style={{ width: `${weekPercent}%` }} />
        </div>
      </div>

      <div className="week-days">
        {weekDays.map((day) => {
          const percent = cap ? Math.min(100, Math.round((day.points / cap) * 100)) : 0;
          const filled = day.hitCap || percent >= 100;

          return (
            <button
              key={day.date}
              className={`week-day ${day.isToday ? 'today' : ''} ${filled ? 'filled' : ''} ${day.isSelected ? 'selected' : ''}`}
              title={`${day.date}: ${day.points}p`}
              onClick={() => onSelectDate?.(day.isSelected ? null : day.date)}
            >
              <div className="day-bar-container">
                <div
                  className="day-bar"
                  style={{ height: `${Math.max(4, percent)}%` }}
                />
              </div>
              <div className="day-label">{day.weekday}</div>
              <div className="day-points">{day.points > 0 ? day.points : '–'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default WeekProgress;

