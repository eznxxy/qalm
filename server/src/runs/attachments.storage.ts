import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { APP_CONFIG } from '../config.module';
import { AppConfig } from '../config';

/**
 * Result-attachment byte storage, docs/api-runs.md § Implementation notes.
 *
 * Bytes live under `<STORAGE_DIR>/attachments/<projectId>/<attachmentId>`; the
 * attachment id is the storage key, so the original filename never becomes a
 * path. Serve only through `GET /attachments/:id` — there is no static route.
 *
 * The resolved root is configuration and is deliberately never logged. A
 * missing file is reported as `null` (→ 404), not an exception, so a metadata
 * row whose bytes vanished cannot crash a download.
 */
@Injectable()
export class AttachmentStorage {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = path.resolve(config.storageDir, 'attachments');
  }

  /** The relative DB key for one attachment (`result_attachments.storage_key`). */
  keyFor(projectId: string, attachmentId: string): string {
    return `${projectId}/${attachmentId}`;
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }

  /** `null` when the file is gone; other I/O errors still surface. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  }

  /** Idempotent: deleting an already-gone file is not an error. */
  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }

  /**
   * Joins a key under the attachments root. `projectId` is a validated UUID and
   * the attachment id is server-generated, but the join still refuses any key
   * that would escape the root — defence against a tampered metadata row.
   */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error('Attachment storage key escapes the storage root.');
    }
    return target;
  }
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}