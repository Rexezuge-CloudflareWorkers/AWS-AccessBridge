import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
  },
  resolve: {
    alias: [
      { find: /^@aws-access-bridge\/background\/(.*)$/, replacement: path.resolve(__dirname, './apps/background/src/$1.ts') },
      { find: '@aws-access-bridge/background', replacement: path.resolve(__dirname, './apps/background/src/index.ts') },
      { find: /^@\/scheduled\/(.*)$/, replacement: path.resolve(__dirname, './apps/background/src/scheduled/$1') },
      { find: '@/scheduled', replacement: path.resolve(__dirname, './apps/background/src/scheduled/index.ts') },
      { find: /^@\/(base|constants|crypto|dao|error|model|utils)\/(.*)$/, replacement: path.resolve(__dirname, './packages/backend-core/src/$1/$2') },
      { find: /^@\/(base|constants|crypto|dao|error|model|utils)$/, replacement: path.resolve(__dirname, './packages/backend-core/src/$1/index.ts') },
      { find: '@', replacement: path.resolve(__dirname, './apps/api/src') },
      { find: 'hono/http-exception', replacement: path.resolve(__dirname, './apps/api/node_modules/hono/dist/http-exception.js') },
      { find: 'hono/utils/http-status', replacement: path.resolve(__dirname, './apps/api/node_modules/hono/dist/utils/http-status.js') },
      { find: 'hono', replacement: path.resolve(__dirname, './apps/api/node_modules/hono') },
      { find: 'cloudflare:workers', replacement: path.resolve(__dirname, './test/mocks/cloudflare-workers.ts') },
    ],
  },
});
