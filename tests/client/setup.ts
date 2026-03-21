// =============================================================================
// Fleet Commander -- Client Test Setup
//
// This setup file runs inside each vitest worker fork. It ensures proper cleanup
// after every test file to prevent jsdom memory accumulation that causes OOM
// on CI runners with limited RAM.
// =============================================================================

import { afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure React Testing Library cleans up rendered components after every test.
// With globals: true this should be automatic, but we make it explicit to be safe.
afterEach(() => {
  cleanup();
});

// Force garbage collection after each test file completes (if --expose-gc is set).
// This helps reclaim jsdom memory between test files within the same worker fork.
afterAll(() => {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
});
