import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest does not read the `paths` mapping from tsconfig.json, so the `@/…` alias used
 * by the API routes is declared here too. The library and content files use relative
 * imports, so the tests would resolve even without this file; it is a second layer.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
