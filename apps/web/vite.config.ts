import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the screens run on :5173 and pass /api calls to the API on :4000.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  // Fonts stay files (served by Ekotrace), never inlined as data: URLs, so the CSP can keep font-src 'self'.
  build: { outDir: 'dist', sourcemap: false, assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
});
