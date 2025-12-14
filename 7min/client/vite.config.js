import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const certPath = process.env.VITE_DEV_SSL_CERT;
const keyPath = process.env.VITE_DEV_SSL_KEY;

const httpsConfig =
  certPath &&
  keyPath &&
  fs.existsSync(certPath) &&
  fs.existsSync(keyPath)
    ? {
        cert: fs.readFileSync(path.resolve(certPath)),
        key: fs.readFileSync(path.resolve(keyPath)),
      }
    : undefined;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: httpsConfig,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
