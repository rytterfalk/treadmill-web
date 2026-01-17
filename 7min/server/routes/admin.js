const express = require('express');
const { db, getUserById } = require('../db');
const { authRequired, hashPassword } = require('../auth');

const router = express.Router();

// Middleware to check if user is admin
function adminRequired(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Get all users (admin only)
router.get('/users', authRequired, adminRequired, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, is_admin, created_at
    FROM users
    ORDER BY created_at DESC
  `).all();
  
  res.json({ users });
});

// Get single user (admin only)
router.get('/users/:id', authRequired, adminRequired, (req, res) => {
  const user = db.prepare(`
    SELECT id, name, email, is_admin, created_at
    FROM users
    WHERE id = ?
  `).get(req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'Användaren finns inte' });
  }
  
  res.json({ user });
});

// Update user (admin only) - can update name, email, password
router.put('/users/:id', authRequired, adminRequired, (req, res) => {
  const { id } = req.params;
  const { name, email, password } = req.body;
  
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'Användaren finns inte' });
  }
  
  // Build update query dynamically
  const updates = [];
  const params = [];
  
  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name.trim());
  }
  
  if (email !== undefined) {
    // Check if email is already used by another user
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), id);
    if (existing) {
      return res.status(400).json({ error: 'E-postadressen används redan' });
    }
    updates.push('email = ?');
    params.push(email.trim().toLowerCase());
  }
  
  if (password !== undefined) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Lösenordet måste vara minst 6 tecken' });
    }
    updates.push('password_hash = ?');
    params.push(hashPassword(password));
  }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'Inget att uppdatera' });
  }
  
  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  
  const updated = db.prepare(`
    SELECT id, name, email, is_admin, created_at
    FROM users
    WHERE id = ?
  `).get(id);
  
  res.json({ user: updated, message: 'Användaren uppdaterad' });
});

// Delete user (admin only) - can't delete yourself
router.delete('/users/:id', authRequired, adminRequired, (req, res) => {
  const { id } = req.params;
  const userId = Number(id);
  
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Du kan inte ta bort dig själv' });
  }
  
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'Användaren finns inte' });
  }
  
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  
  res.json({ ok: true, message: 'Användaren borttagen' });
});

module.exports = { router, adminRequired };

