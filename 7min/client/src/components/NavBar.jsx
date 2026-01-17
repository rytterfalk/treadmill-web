import { useState, useEffect } from 'react';

function NavBar({ user, view, onChangeView, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu when view changes
  useEffect(() => {
    setMenuOpen(false);
  }, [view]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (!e.target.closest('.topbar')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [menuOpen]);

  const handleNavClick = (newView) => {
    onChangeView(newView);
    setMenuOpen(false);
  };

  return (
    <header className={`topbar ${menuOpen ? 'menu-open' : ''}`}>
      <div className="topbar-header">
        <div className="brand">
          <span className="dot" />
          <div>
            <div className="logo-text">7 min studio</div>
            <small>Personlig träningsportal</small>
          </div>
        </div>

        <button
          className="hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Öppna meny"
          aria-expanded={menuOpen}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
      </div>

      <div className="menu-container">
        <nav className="menu">
          <button
            className={view === 'dashboard' ? 'menu-item active' : 'menu-item'}
            onClick={() => handleNavClick('dashboard')}
          >
            START!
          </button>
          <button
            className={view === 'programs' ? 'menu-item active' : 'menu-item'}
            onClick={() => handleNavClick('programs')}
          >
            Passen
          </button>
          <button
            className={view === 'calendar' ? 'menu-item active' : 'menu-item'}
            onClick={() => handleNavClick('calendar')}
          >
            Progress
          </button>
          <button
            className={view === 'equipment' ? 'menu-item active' : 'menu-item'}
            onClick={() => handleNavClick('equipment')}
          >
            Utrustning
          </button>
          {user.is_admin === 1 && (
            <button
              className={view === 'admin' ? 'menu-item active' : 'menu-item'}
              onClick={() => handleNavClick('admin')}
            >
              Admin
            </button>
          )}
        </nav>

        <div className="user-area">
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <small>{user.email}</small>
          </div>
          <button className="ghost" onClick={onLogout}>
            Logga ut
          </button>
        </div>
      </div>
    </header>
  );
}

export default NavBar;
