import { defineConfig } from 'tsup';

export default defineConfig([
  // Main entry (index re-exports everything).
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2022',
    treeshake: true,
  },
  // Subpath entries for "./text" and "./theme".
  {
    entry: {
      'text/index': 'src/text.ts',
      'theme/index': 'src/theme/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2022',
    treeshake: true,
  },
]);
