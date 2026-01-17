const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET } = require('./config');
const { db, getUserById } = require('./db');

function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  const isSecure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.CLIENT_ORIGIN?.startsWith('https://') ||
    process.env.NODE_ENV === 'production';
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

function authRequired(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Auth required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: 'Invalid user' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function hashPassword(password) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function createUser({ name, email, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return { error: 'Email används redan' };

  const password_hash = hashPassword(password);
  const stmt = db.prepare(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
  );
  const result = stmt.run(name, email, password_hash);
  return getUserById(result.lastInsertRowid);
}

function authenticate(email, password) {
  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase());
  if (!row) return null;
  if (!comparePassword(password, row.password_hash)) return null;
  return getUserById(row.id);
}

module.exports = {
  authRequired,
  createToken,
  setAuthCookie,
  createUser,
  authenticate,
  hashPassword,
};
