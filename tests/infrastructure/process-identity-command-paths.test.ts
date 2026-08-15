import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { readProcessIdentity } from '../../src/infrastructure/process-identity.js';

const originalPlatform = process.platform;

afterEach(() => {
  setPlatform(originalPlatform);
  execFileSyncMock.mockReset();
});

describe('process identity command paths', () => {
  it('uses the fixed Windows PowerShell path instead of PATH lookup', () => {
    setPlatform('win32');
    execFileSyncMock.mockReturnValue('638908128000000000\n');

    expect(readProcessIdentity(1234)).toBe('win32:638908128000000000');
    expect(execFileSyncMock).toHaveBeenCalledWith(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$processInfo = Get-Process -Id 1234 -ErrorAction Stop; $processInfo.StartTime.ToUniversalTime().Ticks',
      ],
      expect.objectContaining({
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
  });

  it('rejects malformed Windows process creation output', () => {
    setPlatform('win32');
    execFileSyncMock.mockReturnValue('not-a-tick-count\n');

    expect(readProcessIdentity(1234)).toBeUndefined();
  });

  it('uses the fixed /bin/ps path on Darwin', () => {
    setPlatform('darwin');
    const startedAtText = 'Mon Aug 11 12:34:56 2025';
    execFileSyncMock.mockReturnValue(`${startedAtText}\n`);

    expect(readProcessIdentity(4321)).toBe(`darwin:${String(Date.parse(startedAtText))}`);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      '/bin/ps',
      ['-o', 'lstart=', '-p', '4321'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('uses the fixed /usr/bin/ps path on AIX', () => {
    setPlatform('aix');
    const startedAtText = 'Mon Aug 11 12:34:56 2025';
    execFileSyncMock.mockReturnValue(`${startedAtText}\n`);

    expect(readProcessIdentity(4321)).toBe(`aix:${String(Date.parse(startedAtText))}`);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      '/usr/bin/ps',
      ['-o', 'lstart=', '-p', '4321'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('falls back conservatively when no fixed ps path is defined', () => {
    setPlatform('unsupported-platform');

    expect(readProcessIdentity(9876)).toBeUndefined();
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('falls back conservatively when a process probe fails', () => {
    setPlatform('win32');
    execFileSyncMock.mockImplementation(() => {
      throw new Error('probe failed');
    });

    expect(readProcessIdentity(1234)).toBeUndefined();
  });
});

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    value: platform,
  });
}
