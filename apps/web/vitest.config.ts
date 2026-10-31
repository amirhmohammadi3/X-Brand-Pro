import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30000,
    include: ['test/**/*.spec.ts'],
  },
  plugins: [
    // TSX/components need emitDecoratorMetadata-free JSX; SWC keeps transforms
    // consistent with the Next build. React component tests (Testing Library)
    // switch this to jsdom in Q0.1.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
