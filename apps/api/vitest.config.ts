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
    globalSetup: ['test/global-setup.ts'],
  },
  plugins: [
    // NestJS decorators need emitDecoratorMetadata — the SWC plugin provides it.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
