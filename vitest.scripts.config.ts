// vitest.scripts.config.ts
// Separate vitest config for scripts/ tests (scripts/**/*.test.ts).
// These run in Node environment, NOT jsdom (script modules use Node APIs).
//
// Run with:  npx vitest run --config vitest.scripts.config.ts
// Watch:     npx vitest --config vitest.scripts.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/**/*.{test,spec}.{ts,js}'],
    exclude: ['src/**', 'api/**', 'node_modules/**'],
  },
});
