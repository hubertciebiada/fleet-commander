import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Standalone client config — mirrors the 'client' project in vitest.config.ts.
// Used by `npm run test:client` for isolated client-only runs.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/client/**/*.test.tsx'],
    environment: 'jsdom',
    globals: true,
    pool: 'forks',
    fileParallelism: false,
  },
});
