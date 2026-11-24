import { defineConfig } from 'vitest/config';
// API tests share one TEST_DATABASE_URL and wipe its tables, so files must not run in parallel.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', fileParallelism: false } });
