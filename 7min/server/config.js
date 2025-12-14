const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

module.exports = {
  PORT,
  CLIENT_ORIGIN,
  JWT_SECRET,
  DB_PATH,
  UPLOAD_DIR,
};
