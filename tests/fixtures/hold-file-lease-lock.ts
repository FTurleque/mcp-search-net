import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';
import { SystemClock } from '../../src/infrastructure/time/system-clock.js';

const root = mkdtempSync(join(tmpdir(), 'mcp-file-lease-child-'));
const lockPath = join(root, 'maintenance.lock');
const lease = new FileLeaseLock(lockPath, {
  staleAfterMs: 5_000,
  clock: new SystemClock(),
}).acquire();
const heartbeat = setInterval(() => lease.renew(), 50);

process.send?.({ type: 'ready', root, lockPath });

process.on('message', (message) => {
  if (message !== 'release') return;
  clearInterval(heartbeat);
  lease.release();
  process.exit(0);
});
