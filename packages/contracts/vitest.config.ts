import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
    include: ['src/__tests__/**/*.spec.ts'],
  },
});
