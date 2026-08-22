import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROCESS_IDENTITY_TIMEOUT_MS = 2_000;
const PROCESS_IDENTITY_COMPARISON_ATTEMPTS = 2;
const WINDOWS_POWERSHELL_PATH = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const POSIX_PS_PATHS: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  aix: '/usr/bin/ps',
  darwin: '/bin/ps',
  freebsd: '/bin/ps',
  openbsd: '/bin/ps',
  sunos: '/usr/bin/ps',
};

export type ProcessIdentityComparison = 'same' | 'different' | 'unavailable';

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

/**
 * Compares one recorded process-lifetime identity with the process currently owning a PID.
 * A short retry budget absorbs transient identity-probe failures. Callers remain responsible
 * for applying their lease timeout when the identity cannot be established at all.
 */
export function compareProcessIdentity(
  recordedIdentity: string | null | undefined,
  pid: number,
  probe: (pid: number) => string | undefined = readProcessIdentity,
): ProcessIdentityComparison {
  if (recordedIdentity === undefined || recordedIdentity === null || recordedIdentity === '') {
    return 'unavailable';
  }

  for (let attempt = 0; attempt < PROCESS_IDENTITY_COMPARISON_ATTEMPTS; attempt += 1) {
    const activeIdentity = probe(pid);
    if (activeIdentity === undefined) continue;
    return activeIdentity === recordedIdentity ? 'same' : 'different';
  }
  return 'unavailable';
}

function readLinuxProcessIdentity(pid: number): string | undefined {
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
  const commandEnd = stat.lastIndexOf(')');
  if (bootId === '' || commandEnd === -1) return undefined;

  // /proc/<pid>/stat field 22 is starttime. After removing fields 1 (pid) and
  // 2 (comm), the remaining token array starts at field 3, so starttime is 19.
  const fields = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
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
    WINDOWS_POWERSHELL_PATH,
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
  const psPath = POSIX_PS_PATHS[process.platform];
  if (psPath === undefined) return undefined;

  const startedAtText = execFileSync(psPath, ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: PROCESS_IDENTITY_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const startedAt = Date.parse(startedAtText);
  if (!Number.isFinite(startedAt)) return undefined;
  return `${process.platform}:${String(startedAt)}`;
}
