import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
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
import { compareProcessIdentity, readProcessIdentity } from '../process-identity.js';

const FAILED_ACQUIRE_CLEANUP_ATTEMPTS = 3;
const STALE_RECOVERY_CLEANUP_ATTEMPTS = 3;

export interface FileLeaseMetadata {
  readonly schemaVersion: '1.0' | '1.1' | '1.2';
  readonly ownerToken: string;
  readonly pid: number;
  readonly hostname: string;
  readonly processIdentity?: string | null;
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
  readonly processIdentity?: (pid: number) => string | undefined;
  readonly renameFile?: (oldPath: string, newPath: string) => void;
  readonly unlinkFile?: (path: string) => void;
  readonly writeHeartbeatFile?: (path: string, content: string) => void;
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
  private readonly processIdentity: (pid: number) => string | undefined;
  private readonly renameFile: (oldPath: string, newPath: string) => void;
  private readonly unlinkFile: (path: string) => void;
  private readonly writeHeartbeatFile: (path: string, content: string) => void;

  public constructor(
    private readonly lockPath: string,
    private readonly options: FileLeaseLockOptions,
  ) {
    this.pid = options.pid ?? process.pid;
    this.hostname = options.hostname ?? hostname();
    this.ownerTokenFactory = options.ownerTokenFactory ?? randomUUID;
    this.processAlive = options.processAlive ?? isProcessAlive;
    this.processIdentity = options.processIdentity ?? readProcessIdentity;
    this.renameFile = options.renameFile ?? renameSync;
    this.unlinkFile = options.unlinkFile ?? unlinkSync;
    this.writeHeartbeatFile =
      options.writeHeartbeatFile ??
      ((path, content) =>
        writeFileSync(path, content, {
          encoding: 'utf8',
          flag: 'w',
          mode: 0o600,
        }));
  }

  public acquire(): FileLease {
    validateStaleAfter(this.options.staleAfterMs);
    mkdirSync(dirname(this.lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const metadata = this.createMetadata();
      try {
        writeExclusive(this.lockPath, metadata);
        try {
          this.writeInitialHeartbeat(metadata);
        } catch (error) {
          this.rollbackFailedAcquire(metadata, error);
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
      schemaVersion: '1.2',
      ownerToken: this.ownerTokenFactory(),
      pid: this.pid,
      hostname: this.hostname,
      processIdentity: this.processIdentity(this.pid) ?? null,
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
        this.publishHeartbeat(current);
        this.requireOwnedMetadata(current.ownerToken);
      },
      release: () => {
        if (released) return;
        const onDisk = this.readMetadata();
        const lockExists = existsSync(this.lockPath);
        if (onDisk?.ownerToken === current.ownerToken && lockExists) {
          this.unlinkFile(this.lockPath);
        } else if (lockExists) {
          this.options.logger?.warning('file_lease_lock_release_owner_mismatch', {
            lockPath: this.lockPath,
            pid: current.pid,
          });
        }

        // Finalization is deliberately resumable. If the main lock was removed but heartbeat
        // cleanup fails (for example transient EBUSY/EPERM on Windows), released stays false so
        // a retry resumes from the remaining owner-scoped heartbeat instead of returning early.
        this.removeHeartbeatIfOwned(current);
        released = true;
      },
    };
  }

  private rollbackFailedAcquire(metadata: FileLeaseMetadata, primaryError: unknown): void {
    if (readMetadataFile(this.lockPath)?.ownerToken !== metadata.ownerToken) return;

    const cleanupFailures: unknown[] = [];
    this.removeFailedAcquireHeartbeat(metadata, cleanupFailures);
    let activeLockRemoved = false;

    for (let attempt = 1; attempt <= FAILED_ACQUIRE_CLEANUP_ATTEMPTS; attempt += 1) {
      const current = readMetadataFile(this.lockPath);
      if (current?.ownerToken !== metadata.ownerToken) {
        activeLockRemoved = true;
        break;
      }

      try {
        this.unlinkFile(this.lockPath);
        activeLockRemoved = true;
        break;
      } catch (unlinkError) {
        if (isFileSystemError(unlinkError, 'ENOENT')) {
          activeLockRemoved = true;
          break;
        }
        cleanupFailures.push(unlinkError);
      }

      const quarantinePath = `${this.lockPath}.failed-acquire-${randomUUID()}`;
      try {
        this.renameFile(this.lockPath, quarantinePath);
        activeLockRemoved = true;
        this.cleanupFailedAcquireQuarantine(quarantinePath, metadata.ownerToken, cleanupFailures);
        break;
      } catch (renameError) {
        if (isFileSystemError(renameError, 'ENOENT')) {
          activeLockRemoved = true;
          break;
        }
        cleanupFailures.push(renameError);
      }
    }

    if (!activeLockRemoved) {
      this.options.logger?.error('file_lease_lock_acquire_rollback_failed', {
        lockPath: this.lockPath,
        pid: this.pid,
        attempts: FAILED_ACQUIRE_CLEANUP_ATTEMPTS,
      });
    }
    attachCleanupFailures(primaryError, cleanupFailures);
  }

  private removeFailedAcquireHeartbeat(
    metadata: FileLeaseMetadata,
    cleanupFailures: unknown[],
  ): void {
    const path = this.heartbeatPath(metadata);
    if (!existsSync(path)) return;
    try {
      this.unlinkFile(path);
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) cleanupFailures.push(error);
    }
  }

  private cleanupFailedAcquireQuarantine(
    quarantinePath: string,
    ownerToken: string,
    cleanupFailures: unknown[],
  ): void {
    if (readMetadataFile(quarantinePath)?.ownerToken !== ownerToken) {
      cleanupFailures.push(
        new FileLeaseLockError(
          `Quarantined lock ownership changed unexpectedly: ${quarantinePath}`,
        ),
      );
      return;
    }
    try {
      this.unlinkFile(quarantinePath);
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) return;
      cleanupFailures.push(error);
      this.options.logger?.warning('file_lease_lock_acquire_quarantine_cleanup_failed', {
        lockPath: this.lockPath,
        quarantinePath,
        pid: this.pid,
      });
    }
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

    if (this.processAlive(metadata.pid)) {
      const identity = compareProcessIdentity(
        metadata.processIdentity,
        metadata.pid,
        this.processIdentity,
      );
      if (identity === 'same') return false;
      if (identity === 'unavailable') {
        this.options.logger?.warning('file_lease_lock_stale_identity_unavailable', {
          lockPath: this.lockPath,
          ownerPid: metadata.pid,
          ageMs,
        });
        // A live PID without a comparable process-lifetime identity is ambiguous. Recovering
        // solely from an expired heartbeat could violate mutual exclusion while the owner is
        // blocked in a synchronous critical section, so fail closed and require later/manual
        // recovery instead. Only a confirmed PID reuse may recover a live-PID lease.
        return false;
      }
      // identity === 'different' proves PID reuse, so stale recovery may continue.
    }

    // The quarantine name contains only server-generated randomness. Lock metadata is
    // external state and must never influence a filesystem path.
    const quarantinePath = `${this.lockPath}.stale-${randomUUID()}`;
    try {
      this.renameFile(this.lockPath, quarantinePath);
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) return true;
      throw error;
    }

    const quarantined = readMetadataFile(quarantinePath);
    if (quarantined?.ownerToken !== metadata.ownerToken) {
      if (!existsSync(this.lockPath)) this.renameFile(quarantinePath, this.lockPath);
      throw new FileLeaseLockError(`Lock changed during stale recovery: ${this.lockPath}`);
    }

    const quarantineCleanupComplete = this.cleanupStaleOwnedFile(
      quarantinePath,
      metadata.ownerToken,
      'quarantine',
    );
    const heartbeatCleanupComplete = this.cleanupStaleOwnedFile(
      this.heartbeatPath(metadata),
      metadata.ownerToken,
      'heartbeat',
    );
    this.options.logger?.warning('file_lease_lock_stale_recovered', {
      lockPath: this.lockPath,
      ownerPid: metadata.pid,
      ageMs,
      cleanupComplete: quarantineCleanupComplete && heartbeatCleanupComplete,
    });
    return true;
  }

  private cleanupStaleOwnedFile(
    path: string,
    ownerToken: string,
    target: 'quarantine' | 'heartbeat',
  ): boolean {
    if (!existsSync(path)) return true;
    const metadata = readMetadataFile(path);
    if (metadata?.ownerToken !== ownerToken) {
      this.options.logger?.warning('file_lease_lock_stale_cleanup_owner_mismatch', {
        lockPath: this.lockPath,
        path,
        target,
        pid: this.pid,
      });
      return false;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= STALE_RECOVERY_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        this.unlinkFile(path);
        return true;
      } catch (error) {
        if (isFileSystemError(error, 'ENOENT')) return true;
        lastError = error;
      }
    }

    this.options.logger?.warning('file_lease_lock_stale_cleanup_failed', {
      lockPath: this.lockPath,
      path,
      target,
      pid: this.pid,
      attempts: STALE_RECOVERY_CLEANUP_ATTEMPTS,
      error: lastError instanceof Error ? { name: lastError.name } : 'unknown',
    });
    return false;
  }

  private readMetadata(): FileLeaseMetadata | undefined {
    const metadata = readMetadataFile(this.lockPath);
    if (metadata === undefined) return undefined;
    const heartbeat = readMetadataFile(this.heartbeatPath(metadata));
    return heartbeat?.ownerToken === metadata.ownerToken
      ? { ...metadata, heartbeatAt: heartbeat.heartbeatAt }
      : metadata;
  }

  private writeInitialHeartbeat(metadata: FileLeaseMetadata): void {
    const path = this.heartbeatPath(metadata);
    this.writeHeartbeatFile(path, serializeMetadata(metadata));
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  }

  private publishHeartbeat(metadata: FileLeaseMetadata): void {
    const path = this.heartbeatPath(metadata);
    const stagingPath = `${this.lockPath}.renew-stage-${randomUUID()}`;
    try {
      this.writeHeartbeatFile(stagingPath, serializeMetadata(metadata));
      if (process.platform !== 'win32') chmodSync(stagingPath, 0o600);
      this.renameFile(stagingPath, path);
      if (process.platform !== 'win32') chmodSync(path, 0o600);
    } catch (error) {
      if (existsSync(stagingPath)) {
        try {
          this.unlinkFile(stagingPath);
        } catch (cleanupError) {
          if (!isFileSystemError(cleanupError, 'ENOENT')) {
            attachCleanupFailures(error, [cleanupError]);
          }
        }
      }
      throw error;
    }
  }

  private removeHeartbeatIfOwned(metadata: FileLeaseMetadata): void {
    const path = this.heartbeatPath(metadata);
    if (readMetadataFile(path)?.ownerToken === metadata.ownerToken && existsSync(path)) {
      this.unlinkFile(path);
    }
  }

  private heartbeatPath(metadata: Pick<FileLeaseMetadata, 'schemaVersion' | 'ownerToken'>): string {
    return metadata.schemaVersion === '1.2'
      ? `${this.lockPath}.heartbeat-${ownerTokenFingerprint(metadata.ownerToken)}`
      : `${this.lockPath}.heartbeat`;
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
  const schemaVersion = record['schemaVersion'];
  if (schemaVersion !== '1.0' && schemaVersion !== '1.1' && schemaVersion !== '1.2') return false;
  if (
    typeof record['ownerToken'] !== 'string' ||
    record['ownerToken'].length === 0 ||
    !Number.isSafeInteger(record['pid']) ||
    (record['pid'] as number) <= 0 ||
    typeof record['hostname'] !== 'string' ||
    record['hostname'].length === 0 ||
    typeof record['createdAt'] !== 'string' ||
    !Number.isFinite(Date.parse(record['createdAt'])) ||
    typeof record['heartbeatAt'] !== 'string' ||
    !Number.isFinite(Date.parse(record['heartbeatAt']))
  ) {
    return false;
  }
  if (schemaVersion === '1.0') return true;
  return record['processIdentity'] === null || typeof record['processIdentity'] === 'string';
}

function ownerTokenFingerprint(ownerToken: string): string {
  return createHash('sha256').update(ownerToken).digest('hex');
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

function attachCleanupFailures(primaryError: unknown, cleanupFailures: readonly unknown[]): void {
  if (!(primaryError instanceof Error) || cleanupFailures.length === 0) return;
  const cleanupCause =
    cleanupFailures.length === 1
      ? cleanupFailures[0]
      : new AggregateError(
          cleanupFailures,
          'File lease acquisition rollback had multiple failures',
        );
  const cause =
    primaryError.cause === undefined
      ? cleanupCause
      : new AggregateError(
          [primaryError.cause, cleanupCause],
          'File lease acquisition failed with additional rollback failures',
        );
  Reflect.defineProperty(primaryError, 'cause', {
    configurable: true,
    value: cause,
  });
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
