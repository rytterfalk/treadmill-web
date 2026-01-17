import { useState, useEffect } from 'react';
import { api } from '../api';

function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/admin/users');
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(user) {
    setEditingUser(user);
    setEditForm({ name: user.name, email: user.email, password: '' });
    setMessage('');
  }

  function cancelEdit() {
    setEditingUser(null);
    setEditForm({ name: '', email: '', password: '' });
    setMessage('');
  }

  async function saveUser(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    
    const updates = {};
    if (editForm.name !== editingUser.name) updates.name = editForm.name;
    if (editForm.email !== editingUser.email) updates.email = editForm.email;
    if (editForm.password) updates.password = editForm.password;
    
    if (Object.keys(updates).length === 0) {
      setMessage('Inget att uppdatera');
      setSaving(false);
      return;
    }
    
    try {
      const data = await api(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      setMessage(data.message || 'Sparad!');
      setEditingUser(null);
      setEditForm({ name: '', email: '', password: '' });
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user) {
    if (!confirm(`Ta bort ${user.name} (${user.email})?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <div className="admin-panel"><p>Laddar...</p></div>;
  }

  return (
    <div className="admin-panel">
      <h2>Användarhantering</h2>
      
      {error && <div className="status error">{error}</div>}
      {message && <div className="status success">{message}</div>}

      {editingUser ? (
        <form className="admin-edit-form" onSubmit={saveUser}>
          <h3>Redigera: {editingUser.email}</h3>
          <label>
            Namn
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </label>
          <label>
            E-post
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </label>
          <label>
            Nytt lösenord (lämna tomt för att behålla)
            <input
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Minst 6 tecken"
              minLength={editForm.password ? 6 : 0}
              autoComplete="new-password"
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={saving}>{saving ? 'Sparar...' : 'Spara'}</button>
            <button type="button" className="ghost" onClick={cancelEdit}>Avbryt</button>
          </div>
        </form>
      ) : (
        <table className="admin-user-table">
          <thead>
            <tr>
              <th>Namn</th>
              <th>E-post</th>
              <th>Admin</th>
              <th>Skapad</th>
              <th>Åtgärder</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.is_admin ? '✓' : ''}</td>
                <td>{new Date(u.created_at).toLocaleDateString('sv-SE')}</td>
                <td>
                  <button className="small" onClick={() => startEdit(u)}>Redigera</button>
                  <button className="small ghost" onClick={() => deleteUser(u)}>Ta bort</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminPanel;

