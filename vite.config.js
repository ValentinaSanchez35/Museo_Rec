import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: {
      key:  fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    }
  }
});