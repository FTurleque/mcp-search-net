import { writeFileSync } from 'node:fs';

import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';
import { SystemClock } from '../../src/infrastructure/time/system-clock.js';

const lockPath = process.argv[2];
const readyPath = process.argv[3];
if (lockPath === undefined || readyPath === undefined) {
  throw new Error('Expected lock and ready paths');
}

const lease = new FileLeaseLock(lockPath, {
  staleAfterMs: 5_000,
  clock: new SystemClock(),
}).acquire();
const heartbeat = setInterval(() => lease.renew(), 50);
writeFileSync(readyPath, String(process.pid), 'utf8');

process.on('message', (message) => {
  if (message !== 'release') return;
  clearInterval(heartbeat);
  lease.release();
  process.exit(0);
});
