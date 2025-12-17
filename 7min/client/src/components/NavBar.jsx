function NavBar({ user, view, onChangeView, onLogout, onNewProgram }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="dot" />
        <div>
          <div className="logo-text">7 min studio</div>
          <small>Personlig träningsportal</small>
        </div>
      </div>

      <nav className="menu">
        <button
          className={view === 'dashboard' ? 'menu-item active' : 'menu-item'}
          onClick={() => onChangeView('dashboard')}
        >
          Översikt
        </button>
        <button
          className={view === 'calendar' ? 'menu-item active' : 'menu-item'}
          onClick={() => onChangeView('calendar')}
        >
          Progress
        </button>
        <button
          className={view === 'equipment' ? 'menu-item active' : 'menu-item'}
          onClick={() => onChangeView('equipment')}
        >
          Utrustning
        </button>
        <button
          className={view === 'builder' ? 'menu-item active' : 'menu-item'}
          onClick={() => onChangeView('builder')}
        >
          Bygg pass
        </button>
      </nav>

      <div className="user-area">
        <div className="user-info">
          <div className="user-name">{user.name}</div>
          <small>{user.email}</small>
        </div>
        <button className="ghost" onClick={onNewProgram}>
          + Nytt pass
        </button>
        <button className="ghost" onClick={onLogout}>
          Logga ut
        </button>
      </div>
    </header>
  );
}

export default NavBar;
