import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const result = spawnSync(
  process.execPath,
  [resolve('scripts/run-test-suite.mjs'), 'e2e-live', 'vitest.live.config.ts'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RUN_LIVE_SEARXNG: '1',
      RUN_LIVE_CRAWL4AI: '1',
      RUN_LIVE_SERVICES: '1',
    },
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
