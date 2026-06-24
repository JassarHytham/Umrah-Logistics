import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      VITEST: 'true',
      NODE_ENV: 'test',
    },
    globals: true,
    testTimeout: 15000,
  },
});
