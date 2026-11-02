import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Two test environments coexist (F1.3):
//  - `node` (default) for pure-logic specs under test (any .spec.ts);
//  - `jsdom` for component specs that mount React + use the DOM
//    (test/components/.test.tsx), via the per-file
//    `// @vitest-environment jsdom` pragma so we don't pay jsdom's cost for
//    the node specs.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30000,
    include: ['test/**/*.spec.ts', 'test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
  },
  plugins: [
    // TSX/components need emitDecoratorMetadata-free JSX; SWC keeps transforms
    // consistent with the Next build. automatic jsx-runtime so test files
    // don't need an explicit `import React`.
    swc.vite({ module: { type: 'es6' }, jsc: { transform: { react: { runtime: 'automatic' } } } }),
  ],
});
