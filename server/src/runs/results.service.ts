import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { Queryable } from '../db/queryable';
import { ListMeta, buildListMeta } from '../projects/projects.service';
import {
  ATTACHMENT_FILENAME_MAX,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_RESULT,
  ATTACHMENT_TYPES,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
} from './runs.constants';
import { CreateResultDto, ListResultsQuery, UpdateResultDto } from './dto';
import { AttachmentRow, RunsStore } from './runs.store';
import { AttachmentStorage } from './attachments.storage';
import { AttachmentDto, ResultDto, toAttachmentDto, toResultDto } from './runs.types';

/**
 * The uploaded part as multer's memory storage exposes it. Declared locally so
 * the service does not depend on the global `Express.Multer.File` namespace
 * (@types/multer is not installed; Nest types the file as `any`).
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function validationError(field: string, issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', 'Request validation failed.', [{ field, issue }]);
}

function runNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Run not found.');
}

function itemNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Run item not found.');
}

function resultNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Result not found.');
}

function attachmentNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Attachment not found.');
}

function conflict(message: string, field: string): ApiError {
  return new ApiError('CONFLICT', message, [{ field, issue: message.toLowerCase() }]);
}

function forbidden(message: string): ApiError {
  return new ApiError('FORBIDDEN', message);
}

/** Empty/blank text is stored as null, so `""` and an absent field agree. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Result and attachment rules, docs/api-runs.md § Result/Attachment. Append-only
 * results (PRD decision 4): a correction is a new result, and only the item's
 * *latest* result may be edited or carry attachments. Role gating lives in the
 * controller (@Roles); the Tester-on-own-item/own-result guard, the
 * failed-needs-comment rule, the latest-only rule and archived/completed checks
 * live here.
 */
@Injectable()
export class ResultsService {
  constructor(
    @Inject(RunsStore) private readonly store: RunsStore,
    @Inject(AttachmentStorage) private readonly storage: AttachmentStorage,
  ) {}

  /** Record a result on an open run's item (Admin, Lead or the assigned Tester). */
  async createResult(
    caller: AuthUser,
    runId: string,
    itemId: string,
    dto: CreateResultDto,
  ): Promise<ResultDto> {
    const comment = blankToNull(dto.comment);
    if (dto.status === 'failed' && comment === null) {
      throw validationError('comment', 'is required when status is "failed"');
    }

    return this.store.transaction(async (client) => {
      const run = await this.store.findLiveByIdForUpdate(runId, client);
      if (!run) throw runNotFound();
      await this.requireProject(run.project_id, caller, 'write', client);
      if (run.completed_at !== null) {
        throw conflict('Run is completed and cannot be changed.', 'run_id');
      }
      const item = await this.store.findItemForUpdate(runId, itemId, client);
      if (!item) throw itemNotFound();
      if (caller.role === 'tester' && item.assignee_id !== caller.id) {
        throw forbidden('A tester may only record results for items assigned to them.');
      }

      const row = await this.store.insertResult(
        {
          run_item_id: itemId,
          status: dto.status,
          comment,
          elapsed_minutes: dto.elapsed_minutes ?? null,
          defect_url: blankToNull(dto.defect_url),
          created_by: caller.id,
        },
        client,
      );
      await this.store.touchItem(itemId, client);
      await this.store.touchRun(runId, caller.id, client);
      return toResultDto(row, []);
    });
  }

  /** The item's full result history, newest first, paginated. */
  async listResults(
    caller: AuthUser,
    runId: string,
    itemId: string,
    query: ListResultsQuery,
  ): Promise<{ data: ResultDto[]; meta: ListMeta }> {
    const run = await this.store.findLiveById(runId);
    if (!run) throw runNotFound();
    await this.requireProject(run.project_id, caller, 'read');
    const item = await this.store.findItem(runId, itemId);
    if (!item) throw itemNotFound();

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const total = await this.store.countResults(itemId);
    const rows = await this.store.listResults(itemId, limit, (page - 1) * limit);
    const grouped = await this.groupAttachments(rows.map((row) => row.id));
    return {
      data: rows.map((row) => toResultDto(row, grouped.get(row.id) ?? [])),
      meta: buildListMeta(total, page, limit),
    };
  }

  /**
   * Edit the most recent result of an item. `status` is immutable (rejected by
   * the DTO whitelist); comment/defect/elapsed are editable by the author, an
   * Admin or a Lead.
   */
  async updateResult(
    caller: AuthUser,
    id: string,
    dto: UpdateResultDto,
  ): Promise<ResultDto> {
    this.assertNonEmptyResultPatch(dto);

    return this.store.transaction(async (client) => {
      const ctx = await this.store.findResultContextForUpdate(id, client);
      if (!ctx) throw resultNotFound();
      await this.requireProject(ctx.project_id, caller, 'write', client);
      await this.assertLatestResult(ctx.item_id, id, client);
      this.assertResultAuthor(caller, ctx.created_by);

      const comment = dto.comment === undefined ? ctx.comment : blankToNull(dto.comment);
      if (ctx.status === 'failed' && comment === null) {
        throw validationError('comment', 'is required when status is "failed"');
      }

      await this.store.updateResult(
        id,
        {
          comment: dto.comment === undefined ? undefined : comment,
          elapsed_minutes: dto.elapsed_minutes,
          defect_url: dto.defect_url === undefined ? undefined : blankToNull(dto.defect_url),
        },
        client,
      );
      await this.store.touchItem(ctx.item_id, client);

      const updated = await this.store.findResultById(id, client);
      if (!updated) throw resultNotFound();
      const attachments = await this.store.attachmentsByResultIds([id], client);
      return toResultDto(updated, attachments);
    });
  }

  /** Upload one file to the item's latest result (author, Admin or Lead). */
  async uploadAttachment(
    caller: AuthUser,
    resultId: string,
    file: UploadedFile | undefined,
  ): Promise<AttachmentDto> {
    const validated = this.validateUpload(file);

    return this.store.transaction(async (client) => {
      const ctx = await this.store.findResultContextForUpdate(resultId, client);
      if (!ctx) throw resultNotFound();
      await this.requireProject(ctx.project_id, caller, 'write', client);
      await this.assertLatestResult(ctx.item_id, resultId, client);
      this.assertResultAuthor(caller, ctx.created_by);

      const count = await this.store.countAttachments(resultId, client);
      if (count >= ATTACHMENT_MAX_PER_RESULT) {
        throw validationError(
          'file',
          `a result may hold at most ${ATTACHMENT_MAX_PER_RESULT} attachments`,
        );
      }

      const attachmentId = randomUUID();
      const key = this.storage.keyFor(ctx.project_id, attachmentId);
      // Bytes first, metadata row second (contract § Implementation notes); if
      // the row write fails, the orphaned file is removed again.
      await this.storage.save(key, validated.buffer);
      let row: AttachmentRow;
      try {
        row = await this.store.insertAttachment(
          {
            id: attachmentId,
            result_id: resultId,
            filename: validated.filename,
            content_type: validated.contentType,
            size_bytes: validated.buffer.length,
            storage_key: key,
            created_by: caller.id,
          },
          client,
        );
      } catch (error) {
        await this.storage.remove(key);
        throw error;
      }
      await this.store.touchItem(ctx.item_id, client);
      return toAttachmentDto(row);
    });
  }

  /** Bytes plus headers for `GET /attachments/:id` (any authenticated role). */
  async getAttachment(
    caller: AuthUser,
    id: string,
  ): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    const ctx = await this.store.findAttachmentContext(id);
    if (!ctx) throw attachmentNotFound();
    await this.requireProject(ctx.project_id, caller, 'read');
    const bytes = await this.storage.read(ctx.storage_key);
    // A metadata row whose bytes vanished reads as "not found", never a 500.
    if (bytes === null) throw attachmentNotFound();
    return { bytes, filename: ctx.filename, contentType: ctx.content_type };
  }

  /** Delete the latest result's attachment (author, Admin or Lead). */
  async deleteAttachment(caller: AuthUser, id: string): Promise<void> {
    const key = await this.store.transaction(async (client) => {
      const ctx = await this.store.findAttachmentContextForUpdate(id, client);
      if (!ctx) throw attachmentNotFound();
      await this.requireProject(ctx.project_id, caller, 'write', client);
      await this.assertLatestResult(ctx.item_id, ctx.result_id, client);
      this.assertResultAuthor(caller, ctx.result_created_by);
      await this.store.deleteAttachment(id, client);
      await this.store.touchItem(ctx.item_id, client);
      return ctx.storage_key;
    });
    // Row first (above), bytes second (contract § Implementation notes).
    await this.storage.remove(key);
  }

  // --- internals ----------------------------------------------------------

  /** Validates the multipart part; every failure names the `file` field. */
  private validateUpload(
    file: UploadedFile | undefined,
  ): { filename: string; contentType: string; buffer: Buffer } {
    if (!file) throw validationError('file', 'is required');
    const filename = file.originalname.trim();
    if (filename.length < 1 || filename.length > ATTACHMENT_FILENAME_MAX) {
      throw validationError(
        'file',
        `filename must be 1–${ATTACHMENT_FILENAME_MAX} characters`,
      );
    }
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.mimetype)) {
      throw validationError('file', `content type must be one of: ${ATTACHMENT_TYPES.join(', ')}`);
    }
    const buffer = file.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > ATTACHMENT_MAX_BYTES) {
      throw validationError(
        'file',
        `must be between 1 and ${ATTACHMENT_MAX_BYTES} bytes`,
      );
    }
    return { filename, contentType: file.mimetype, buffer };
  }

  /** Only the item's newest result may be edited or carry attachments. */
  private async assertLatestResult(
    itemId: string,
    resultId: string,
    client: Queryable,
  ): Promise<void> {
    const latest = await this.store.latestResultIdOf(itemId, client);
    if (latest !== resultId) {
      throw conflict('Only the most recent result of an item can be changed.', 'result_id');
    }
  }

  /** Admin/Lead bypass; a Tester must own the result. */
  private assertResultAuthor(caller: AuthUser, authorId: string): void {
    if (caller.role === 'admin' || caller.role === 'lead') return;
    if (caller.id !== authorId) {
      throw forbidden('Only the author, an admin or a lead may change this result.');
    }
  }

  private async groupAttachments(resultIds: string[]): Promise<Map<string, AttachmentRow[]>> {
    const rows = await this.store.attachmentsByResultIds(resultIds);
    const grouped = new Map<string, AttachmentRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.result_id);
      if (list) list.push(row);
      else grouped.set(row.result_id, [row]);
    }
    return grouped;
  }

  /**
   * Contract visibility: unknown project → 404; archived project → 409 on every
   * write and 404 for non-Admins on reads.
   */
  private async requireProject(
    projectId: string,
    caller: AuthUser,
    mode: 'read' | 'write',
    q?: Queryable,
  ): Promise<void> {
    const project = await this.store.findProject(projectId, q);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');
    if (project.status !== 'archived') return;
    if (mode === 'write') {
      throw new ApiError('CONFLICT', 'Project is archived and cannot be changed.', [
        { field: 'project_id', issue: 'project is archived' },
      ]);
    }
    if (caller.role !== 'admin') {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
  }

  private assertNonEmptyResultPatch(dto: UpdateResultDto): void {
    if (
      dto.comment !== undefined ||
      dto.elapsed_minutes !== undefined ||
      dto.defect_url !== undefined
    ) {
      return;
    }
    const fields = ['comment', 'elapsed_minutes', 'defect_url'];
    throw new ApiError(
      'VALIDATION_ERROR',
      'Provide at least one field to update.',
      fields.map((field) => ({ field, issue: 'at least one field must be provided' })),
    );
  }
}