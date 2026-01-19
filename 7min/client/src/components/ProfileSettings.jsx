import { useState, useEffect } from 'react';

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Nätverksfel' }));
    throw new Error(error.error || 'Något gick fel');
  }
  return res.json();
};

function ProfileSettings({ user, onUpdate }) {
  const [weightKg, setWeightKg] = useState(user?.weight_kg || '');
  const [heightCm, setHeightCm] = useState(user?.height_cm || '');
  const [birthYear, setBirthYear] = useState(user?.birth_year || '');
  const [sex, setSex] = useState(user?.sex || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setWeightKg(user.weight_kg || '');
      setHeightCm(user.height_cm || '');
      setBirthYear(user.birth_year || '');
      setSex(user.sex || '');
    }
  }, [user]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setStatus('');

    try {
      const payload = {};
      if (weightKg !== '') payload.weight_kg = Number(weightKg);
      if (heightCm !== '') payload.height_cm = Number(heightCm);
      if (birthYear !== '') payload.birth_year = Number(birthYear);
      if (sex !== '') payload.sex = sex;

      const { user: updatedUser } = await api('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setStatus('Sparat!');
      if (onUpdate) onUpdate(updatedUser);
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="profile-settings">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Profil</p>
          <h2>Inställningar</h2>
        </div>
      </div>

      <p className="settings-info">
        Ange din vikt för att få korrekta kalori-beräkningar vid export av träningsdata.
      </p>

      <form onSubmit={handleSave} className="settings-form">
        <label className="settings-field">
          <span>Vikt (kg) *</span>
          <input
            type="number"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="75"
            min="20"
            max="300"
            step="0.1"
          />
        </label>

        <label className="settings-field">
          <span>Längd (cm)</span>
          <input
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="175"
            min="100"
            max="250"
          />
        </label>

        <label className="settings-field">
          <span>Födelseår</span>
          <input
            type="number"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            placeholder="1985"
            min="1900"
            max={currentYear}
          />
        </label>

        <label className="settings-field">
          <span>Kön</span>
          <select value={sex} onChange={(e) => setSex(e.target.value)}>
            <option value="">Välj...</option>
            <option value="male">Man</option>
            <option value="female">Kvinna</option>
            <option value="other">Annat</option>
          </select>
        </label>

        {error && <div className="settings-error">{error}</div>}
        {status && <div className="settings-success">{status}</div>}

        <div className="settings-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </form>

      <div className="settings-note">
        <strong>Varför vikt?</strong> Din vikt används för att beräkna förbrända kalorier (kcal) 
        när du exporterar träningsdata till Strava eller Apple Health. Utan angiven vikt används 
        75 kg som standard, men kalorierna inkluderas inte i exporten.
      </div>
    </div>
  );
}

export default ProfileSettings;

