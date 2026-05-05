// vitest.api.config.ts
// Separate vitest config for server-side tests under api/ and scripts/.
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
    // Include api/ AND scripts/ test files -- never overlap with src/
    include: [
      'api/**/*.{test,spec}.{ts,js}',
      'scripts/**/*.{test,spec}.{ts,js}',
    ],
    // Exclude front-end source
    exclude: ['src/**', 'node_modules/**'],
  },
});
