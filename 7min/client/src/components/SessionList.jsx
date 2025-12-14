function SessionList({ sessions }) {
  if (!sessions?.length) {
    return <p>Du har inte loggat några pass ännu. Kör ett pass och tryck start för att spara.</p>;
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <div className="session" key={session.id}>
          <div className="session-title">{session.program_title || 'Eget pass'}</div>
          <div className="session-meta">
            {session.duration_seconds ? `${session.duration_seconds}s` : 'Okänd tid'} •{' '}
            {new Date(session.completed_at).toLocaleString('sv-SE', {
              hour: '2-digit',
              minute: '2-digit',
              month: 'short',
              day: 'numeric',
            })}
          </div>
          {session.notes && <p className="session-notes">{session.notes}</p>}
        </div>
      ))}
    </div>
  );
}

export default SessionList;
