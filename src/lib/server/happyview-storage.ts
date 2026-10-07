import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageAdapter } from '@happyview/oauth-client';

/** Credentials never share the legacy oauth-sessions namespace. Single-host persistent volume. */
export class HappyViewStorage implements StorageAdapter {
  constructor(private readonly directory: string) {}

  private prepare() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
  }

  private file(key: string) {
    return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json');
  }

  async get(key: string): Promise<string | null> {
    try {
      return readFileSync(this.file(key), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.prepare();
    const destination = this.file(key);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, destination);
    } finally {
      this.remove(temporary);
    }
  }

  async delete(key: string): Promise<void> {
    this.remove(this.file(key));
  }

  /** Atomic across processes: only the successful renamer can consume a callback. */
  async take(key: string): Promise<string | null> {
    const claimed = `${this.file(key)}.${randomUUID()}.claimed`;
    try {
      renameSync(this.file(key), claimed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return readFileSync(claimed, 'utf8');
    } finally {
      this.remove(claimed);
    }
  }

  /** Use only for the short-lived transaction directory, never credentials. */
  prune(before: number) {
    this.prepare();
    for (const file of readdirSync(this.directory)) {
      const path = join(this.directory, file);
      try {
        if (statSync(path).mtimeMs < before) this.remove(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  private remove(path: string) {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
