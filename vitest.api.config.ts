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
    // The sales-email relay (api/_lib/notify/salesEmail.ts) and the shipping-notice relay
    // (api/_lib/notify/shippingRelay.ts) point to a dead port: a test that forgets to stub
    // fetch fails fast instead of emailing ventas@ or a customer. SHIPPING_RELAY_SECRET stays
    // unset, so such a test gets `config` and never calls out.
    env: {
      GAS_RELAY_URL: 'http://127.0.0.1:9/gas-disabled-in-tests',
      SHIPPING_RELAY_URL: 'http://127.0.0.1:9/shipping-relay-disabled-in-tests',
    },
  },
});
