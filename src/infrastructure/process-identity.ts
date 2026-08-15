import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROCESS_IDENTITY_TIMEOUT_MS = 2_000;

/**
 * Returns an OS-backed identity for one concrete process lifetime.
 *
 * A PID alone is not a stable process identity because operating systems reuse PIDs.
 * The returned value therefore includes the process creation identity exposed by the OS.
 * When the platform probe is unavailable, callers must fall back conservatively rather
 * than treating an unverified PID as a different process.
 */
export function readProcessIdentity(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;

  try {
    if (process.platform === 'linux') return readLinuxProcessIdentity(pid);
    if (process.platform === 'win32') return readWindowsProcessIdentity(pid);
    return readPosixProcessIdentity(pid);
  } catch {
    return undefined;
  }
}

function readLinuxProcessIdentity(pid: number): string | undefined {
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
  const commandEnd = stat.lastIndexOf(')');
  if (bootId === '' || commandEnd === -1) return undefined;

  // /proc/<pid>/stat field 22 is starttime. After removing fields 1 (pid) and
  // 2 (comm), the remaining token array starts at field 3, so starttime is 19.
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
  const startTime = fields[19];
  if (startTime === undefined || !/^\d+$/u.test(startTime)) return undefined;
  return `linux:${bootId}:${startTime}`;
}

function readWindowsProcessIdentity(pid: number): string | undefined {
  const command = [
    `$processInfo = Get-Process -Id ${String(pid)} -ErrorAction Stop`,
    '$processInfo.StartTime.ToUniversalTime().Ticks',
  ].join('; ');
  const ticks = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      timeout: PROCESS_IDENTITY_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  ).trim();
  if (!/^\d+$/u.test(ticks)) return undefined;
  return `win32:${ticks}`;
}

function readPosixProcessIdentity(pid: number): string | undefined {
  const startedAtText = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: PROCESS_IDENTITY_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const startedAt = Date.parse(startedAtText);
  if (!Number.isFinite(startedAt)) return undefined;
  return `${process.platform}:${String(startedAt)}`;
}
