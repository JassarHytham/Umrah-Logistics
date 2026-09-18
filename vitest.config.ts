import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      VITEST: 'true',
      NODE_ENV: 'test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'AdminTestPassword123!',
    },
    globals: true,
    testTimeout: 15000,
  },
});
