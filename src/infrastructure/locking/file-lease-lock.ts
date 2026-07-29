import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

import type { Clock } from '../../application/ports/clock.js';
import type { Logger } from '../../application/ports/logger.js';

export interface FileLeaseMetadata {
  readonly schemaVersion: '1.0';
  readonly ownerToken: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly heartbeatAt: string;
}

export interface FileLease {
  readonly metadata: FileLeaseMetadata;
  renew(): void;
  release(): void;
}

export interface FileLeaseLockOptions {
  readonly staleAfterMs: number;
  readonly clock: Clock;
  readonly logger?: Logger;
  readonly pid?: number;
  readonly hostname?: string;
  readonly ownerTokenFactory?: () => string;
  readonly processAlive?: (pid: number) => boolean;
}

export class FileLeaseLockError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FileLeaseLockError';
  }
}

export class FileLeaseLock {
  private readonly pid: number;
  private readonly hostname: string;
  private readonly ownerTokenFactory: () => string;
  private readonly processAlive: (pid: number) => boolean;

  public constructor(
    private readonly lockPath: string,
    private readonly options: FileLeaseLockOptions,
  ) {
    this.pid = options.pid ?? process.pid;
    this.hostname = options.hostname ?? hostname();
    this.ownerTokenFactory = options.ownerTokenFactory ?? randomUUID;
    this.processAlive = options.processAlive ?? isProcessAlive;
  }

  public acquire(): FileLease {
    validateStaleAfter(this.options.staleAfterMs);
    mkdirSync(dirname(this.lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const metadata = this.createMetadata();
      try {
        writeExclusive(this.lockPath, metadata);
        try {
          this.writeHeartbeat(metadata);
        } catch (error) {
          if (readMetadataFile(this.lockPath)?.ownerToken === metadata.ownerToken) {
            unlinkSync(this.lockPath);
          }
          throw error;
        }
        return this.createLease(metadata);
      } catch (error) {
        if (!isFileSystemError(error, 'EEXIST')) throw error;
        if (!this.recoverStaleLock()) {
          const owner = this.readMetadata();
          throw new FileLeaseLockError(
            owner === undefined
              ? `Lock metadata is invalid; manual recovery is required: ${this.lockPath}`
              : `Lock is owned by pid ${owner.pid} on ${owner.hostname}: ${this.lockPath}`,
          );
        }
      }
    }

    throw new FileLeaseLockError(`Lock acquisition raced with another process: ${this.lockPath}`);
  }

  private createMetadata(): FileLeaseMetadata {
    const now = this.options.clock.now().toISOString();
    return {
      schemaVersion: '1.0',
      ownerToken: this.ownerTokenFactory(),
      pid: this.pid,
      hostname: this.hostname,
      createdAt: now,
      heartbeatAt: now,
    };
  }

  private createLease(initial: FileLeaseMetadata): FileLease {
    let current = initial;
    let released = false;
    return {
      metadata: initial,
      renew: () => {
        if (released) throw new FileLeaseLockError('Cannot renew a released lock');
        const onDisk = this.requireOwnedMetadata(current.ownerToken);
        current = { ...onDisk, heartbeatAt: this.options.clock.now().toISOString() };
        this.writeHeartbeat(current);
        this.requireOwnedMetadata(current.ownerToken);
      },
      release: () => {
        if (released) return;
        released = true;
        const onDisk = this.readMetadata();
        if (onDisk?.ownerToken === current.ownerToken && existsSync(this.lockPath)) {
          unlinkSync(this.lockPath);
          this.removeHeartbeatIfOwned(current.ownerToken);
        } else if (existsSync(this.lockPath)) {
          this.options.logger?.warning('file_lease_lock_release_owner_mismatch', {
            lockPath: this.lockPath,
            pid: current.pid,
          });
        }
      },
    };
  }

  private requireOwnedMetadata(ownerToken: string): FileLeaseMetadata {
    const metadata = this.readMetadata();
    if (metadata?.ownerToken !== ownerToken) {
      throw new FileLeaseLockError(`Lock ownership changed unexpectedly: ${this.lockPath}`);
    }
    return metadata;
  }

  private recoverStaleLock(): boolean {
    const metadata = this.readMetadata();
    if (metadata === undefined) return false;
    const heartbeatAt = Date.parse(metadata.heartbeatAt);
    const ageMs = this.options.clock.now().getTime() - heartbeatAt;
    if (!Number.isFinite(heartbeatAt) || ageMs <= this.options.staleAfterMs) return false;
    if (metadata.hostname !== this.hostname) return false;
    if (this.processAlive(metadata.pid)) return false;

    const quarantinePath = `${this.lockPath}.stale-${metadata.ownerToken}-${randomUUID()}`;
    try {
      renameSync(this.lockPath, quarantinePath);
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) return true;
      throw error;
    }

    const quarantined = readMetadataFile(quarantinePath);
    if (quarantined?.ownerToken !== metadata.ownerToken) {
      if (!existsSync(this.lockPath)) renameSync(quarantinePath, this.lockPath);
      throw new FileLeaseLockError(`Lock changed during stale recovery: ${this.lockPath}`);
    }
    unlinkSync(quarantinePath);
    this.removeHeartbeatIfOwned(metadata.ownerToken);
    this.options.logger?.warning('file_lease_lock_stale_recovered', {
      lockPath: this.lockPath,
      ownerPid: metadata.pid,
      ageMs,
    });
    return true;
  }

  private readMetadata(): FileLeaseMetadata | undefined {
    const metadata = readMetadataFile(this.lockPath);
    if (metadata === undefined) return undefined;
    const heartbeat = readMetadataFile(this.heartbeatPath());
    return heartbeat?.ownerToken === metadata.ownerToken
      ? { ...metadata, heartbeatAt: heartbeat.heartbeatAt }
      : metadata;
  }

  private writeHeartbeat(metadata: FileLeaseMetadata): void {
    writeFileSync(this.heartbeatPath(), serializeMetadata(metadata), {
      encoding: 'utf8',
      flag: 'w',
    });
  }

  private removeHeartbeatIfOwned(ownerToken: string): void {
    const path = this.heartbeatPath();
    if (readMetadataFile(path)?.ownerToken === ownerToken && existsSync(path)) unlinkSync(path);
  }

  private heartbeatPath(): string {
    return `${this.lockPath}.heartbeat`;
  }
}

function writeExclusive(path: string, metadata: FileLeaseMetadata): void {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, serializeMetadata(metadata), { encoding: 'utf8' });
  } finally {
    closeSync(descriptor);
  }
}

function serializeMetadata(metadata: FileLeaseMetadata): string {
  return `${JSON.stringify(metadata)}\n`;
}

function readMetadataFile(path: string): FileLeaseMetadata | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isFileLeaseMetadata(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function isFileLeaseMetadata(value: unknown): value is FileLeaseMetadata {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record['schemaVersion'] === '1.0' &&
    typeof record['ownerToken'] === 'string' &&
    record['ownerToken'].length > 0 &&
    Number.isSafeInteger(record['pid']) &&
    (record['pid'] as number) > 0 &&
    typeof record['hostname'] === 'string' &&
    record['hostname'].length > 0 &&
    typeof record['createdAt'] === 'string' &&
    Number.isFinite(Date.parse(record['createdAt'])) &&
    typeof record['heartbeatAt'] === 'string' &&
    Number.isFinite(Date.parse(record['heartbeatAt']))
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isFileSystemError(error, 'ESRCH')) return false;
    return true;
  }
}

function validateStaleAfter(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FileLeaseLockError('staleAfterMs must be a positive safe integer');
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
