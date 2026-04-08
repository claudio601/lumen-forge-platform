// vitest.api.config.ts
// Separate vitest config for API server-side tests (api/**/*.test.ts).
// These run in Node environment, NOT jsdom (server modules use Node APIs).
//
// Run with:  npx vitest run --config vitest.api.config.ts
// Watch:     npx vitest --config vitest.api.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: required for server modules (fetch, process.env, etc.)
    environment: 'node',
    globals: true,
    // Only include api test files -- never overlap with src/
    include: ['api/**/*.{test,spec}.{ts,js}'],
    // Exclude front-end source
    exclude: ['src/**', 'node_modules/**'],
  },
});
