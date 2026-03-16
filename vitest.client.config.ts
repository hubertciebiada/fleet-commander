import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/client/**/*.test.tsx'],
    environment: 'jsdom',
    globals: true,
  },
});
