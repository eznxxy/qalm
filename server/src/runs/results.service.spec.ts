/* eslint-disable @typescript-eslint/require-await -- the in-memory fakes mirror
   the async store/storage surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { ErrorCode } from '../errors';
import { Queryable } from '../db/queryable';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_RESULT } from './runs.constants';
import { AttachmentStorage } from './attachments.storage';
import { ResultsService, UploadedFile } from './results.service';
import {
  AttachmentContextRow,
  AttachmentRow,
  AttachmentWrite,
  ProjectRef,
  ResultContextRow,
  ResultRow,
  ResultUpdateFields,
  RunsStore,
  RunRow,
} from './runs.store';

/**
 * Decision-logic tests for ResultsService over an in-memory fake of the
 * results/attachments tables and the byte storage. The real SQL path and the
 * multipart wiring are covered by test/results.e2e-spec.ts.
 */
interface FakeItem {
  id: string;
  run_id: string;
  assignee_id: string | null;
  updated_at: Date;
}

class FakeStore {
  projects: ProjectRef[] = [
    { id: 'p-1', status: 'active' },
    { id: 'p-arch', status: 'archived' },
  ];
  runs: RunRow[] = [];
  items: FakeItem[] = [];
  results: ResultRow[] = [];
  attachments: AttachmentRow[] = [];
  failAttachmentInsert = false;

  private nextId = 1;
  private clock = 0;

  private tick(): Date {
    this.clock += 1_000;
    return new Date(Date.UTC(2026, 9, 26, 9, 0, 0) + this.clock);
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const snapshot = {
      items: this.items.map((row) => ({ ...row })),
      results: this.results.map((row) => ({ ...row })),
      attachments: this.attachments.map((row) => ({ ...row })),
      nextId: this.nextId,
      clock: this.clock,
    };
    try {
      return await fn({} as Queryable);
    } catch (error) {
      this.items = snapshot.items;
      this.results = snapshot.results;
      this.attachments = snapshot.attachments;
      this.nextId = snapshot.nextId;
      this.clock = snapshot.clock;
      throw error;
    }
  }

  // --- references ---------------------------------------------------------

  async findProject(projectId: string): Promise<ProjectRef | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  // --- runs / items -------------------------------------------------------

  private liveRun(id: string): RunRow | null {
    return this.runs.find((run) => run.id === id && run.deleted_at === null) ?? null;
  }

  async findLiveById(id: string): Promise<RunRow | null> {
    return this.liveRun(id);
  }

  async findLiveByIdForUpdate(id: string): Promise<RunRow | null> {
    return this.liveRun(id);
  }

  private itemResultCount(itemId: string): number {
    return this.results.filter((result) => result.run_item_id === itemId).length;
  }

  async findItem(runId: string, itemId: string): Promise<FakeItem & { result_count: number } | null> {
    const item = this.items.find((row) => row.id === itemId && row.run_id === runId);
    return item ? { ...item, result_count: this.itemResultCount(itemId) } : null;
  }

  async findItemForUpdate(
    runId: string,
    itemId: string,
  ): Promise<FakeItem & { result_count: number } | null> {
    return this.findItem(runId, itemId);
  }

  async touchItem(itemId: string): Promise<void> {
    const item = this.items.find((row) => row.id === itemId);
    if (item) item.updated_at = this.tick();
  }

  async touchRun(id: string, actorId: string): Promise<void> {
    const run = this.runs.find((row) => row.id === id);
    if (run) {
      run.updated_by = actorId;
      run.updated_at = this.tick();
    }
  }

  private newestResult(itemId: string): ResultRow | null {
    return (
      this.results
        .filter((result) => result.run_item_id === itemId)
        .sort(
          (a, b) =>
            b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id),
        )[0] ?? null
    );
  }

  // --- results ------------------------------------------------------------

  async insertResult(row: {
    run_item_id: string;
    status: ResultRow['status'];
    comment: string | null;
    elapsed_minutes: number | null;
    defect_url: string | null;
    created_by: string;
  }): Promise<ResultRow> {
    const created: ResultRow = {
      id: `res-${this.nextId++}`,
      run_item_id: row.run_item_id,
      status: row.status,
      comment: row.comment,
      elapsed_minutes: row.elapsed_minutes,
      defect_url: row.defect_url,
      created_by: row.created_by,
      created_at: this.tick(),
    };
    this.results.push(created);
    return created;
  }

  async countResults(itemId: string): Promise<number> {
    return this.itemResultCount(itemId);
  }

  async listResults(itemId: string, limit: number, offset: number): Promise<ResultRow[]> {
    return this.results
      .filter((result) => result.run_item_id === itemId)
      .sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id),
      )
      .slice(offset, offset + limit);
  }

  async latestResultIdOf(itemId: string): Promise<string | null> {
    return this.newestResult(itemId)?.id ?? null;
  }

  newestResultId(itemId: string): string {
    const row = this.newestResult(itemId);
    if (!row) throw new Error(`no result for item ${itemId}`);
    return row.id;
  }

  async findResultById(id: string): Promise<ResultRow | null> {
    return this.results.find((result) => result.id === id) ?? null;
  }

  async findResultContextForUpdate(id: string): Promise<ResultContextRow | null> {
    const result = this.results.find((row) => row.id === id);
    if (!result) return null;
    const item = this.items.find((row) => row.id === result.run_item_id);
    if (!item) return null;
    const run = this.liveRun(item.run_id);
    if (!run) return null;
    return {
      ...result,
      item_id: item.id,
      item_assignee_id: item.assignee_id,
      run_id: run.id,
      project_id: run.project_id,
      run_completed_at: run.completed_at,
    };
  }

  async updateResult(id: string, fields: ResultUpdateFields): Promise<ResultRow | null> {
    const row = this.results.find((result) => result.id === id);
    if (!row) return null;
    if (fields.comment !== undefined) row.comment = fields.comment;
    if (fields.elapsed_minutes !== undefined) row.elapsed_minutes = fields.elapsed_minutes;
    if (fields.defect_url !== undefined) row.defect_url = fields.defect_url;
    return row;
  }

  // --- attachments --------------------------------------------------------

  async countAttachments(resultId: string): Promise<number> {
    return this.attachments.filter((row) => row.result_id === resultId).length;
  }

  async insertAttachment(row: AttachmentWrite): Promise<AttachmentRow> {
    if (this.failAttachmentInsert) throw new Error('metadata write failed');
    const created: AttachmentRow = { ...row, created_at: this.tick() };
    this.attachments.push(created);
    return created;
  }

  async attachmentsByResultIds(resultIds: string[]): Promise<AttachmentRow[]> {
    return this.attachments
      .filter((row) => resultIds.includes(row.result_id))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
  }

  private attachmentContext(id: string): AttachmentContextRow | null {
    const attachment = this.attachments.find((row) => row.id === id);
    if (!attachment) return null;
    const result = this.results.find((row) => row.id === attachment.result_id);
    if (!result) return null;
    const item = this.items.find((row) => row.id === result.run_item_id);
    if (!item) return null;
    const run = this.liveRun(item.run_id);
    if (!run) return null;
    return {
      ...attachment,
      result_created_by: result.created_by,
      item_id: item.id,
      item_assignee_id: item.assignee_id,
      run_id: run.id,
      project_id: run.project_id,
      run_completed_at: run.completed_at,
    };
  }

  async findAttachmentContext(id: string): Promise<AttachmentContextRow | null> {
    return this.attachmentContext(id);
  }

  async findAttachmentContextForUpdate(id: string): Promise<AttachmentContextRow | null> {
    return this.attachmentContext(id);
  }

  async deleteAttachment(id: string): Promise<boolean> {
    const before = this.attachments.length;
    this.attachments = this.attachments.filter((row) => row.id !== id);
    return this.attachments.length < before;
  }

  // --- fixtures -----------------------------------------------------------

  addRun(overrides: { projectId?: string; completedAt?: Date | null } = {}): RunRow {
    const now = this.tick();
    const run: RunRow = {
      id: `run-${this.nextId++}`,
      project_id: overrides.projectId ?? 'p-1',
      plan_id: null,
      name: 'Run',
      description: null,
      due_date: null,
      completed_at: overrides.completedAt ?? null,
      completed_by: null,
      created_by: 'u-admin',
      updated_by: 'u-admin',
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.runs.push(run);
    return run;
  }

  addItem(runId: string, overrides: { assigneeId?: string | null } = {}): FakeItem {
    const item: FakeItem = {
      id: `item-${this.nextId++}`,
      run_id: runId,
      assignee_id: overrides.assigneeId ?? null,
      updated_at: this.tick(),
    };
    this.items.push(item);
    return item;
  }

  addResult(
    itemId: string,
    overrides: {
      status?: ResultRow['status'];
      comment?: string | null;
      createdBy?: string;
    } = {},
  ): ResultRow {
    const row: ResultRow = {
      id: `res-${this.nextId++}`,
      run_item_id: itemId,
      status: overrides.status ?? 'passed',
      comment: overrides.comment ?? null,
      elapsed_minutes: null,
      defect_url: null,
      created_by: overrides.createdBy ?? 'u-admin',
      created_at: this.tick(),
    };
    this.results.push(row);
    return row;
  }

  addAttachment(resultId: string, overrides: { filename?: string } = {}): AttachmentRow {
    const row: AttachmentRow = {
      id: `att-${this.nextId++}`,
      result_id: resultId,
      filename: overrides.filename ?? 'evidence.png',
      content_type: 'image/png',
      size_bytes: 3,
      storage_key: `p-1/att-${this.nextId}`,
      created_by: 'u-admin',
      created_at: this.tick(),
    };
    this.attachments.push(row);
    return row;
  }
}

class FakeStorage {
  files = new Map<string, Buffer>();
  removed: string[] = [];
  failSave = false;

  keyFor(projectId: string, attachmentId: string): string {
    return `${projectId}/${attachmentId}`;
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    if (this.failSave) throw new Error('disk full');
    this.files.set(key, bytes);
  }

  async read(key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key);
    this.removed.push(key);
  }
}

const USER: AuthUser = {
  id: 'u-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  isActive: true,
  mustChangePassword: false,
};

const AS = (role: UserRole): AuthUser => ({ ...USER, id: `u-${role}`, role });

function upload(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    originalname: 'evidence.png',
    mimetype: 'image/png',
    size: 3,
    buffer: Buffer.from('abc'),
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('ResultsService (unit, in-memory results)', () => {
  let service: ResultsService;
  let store: FakeStore;
  let storage: FakeStorage;

  beforeEach(async () => {
    store = new FakeStore();
    storage = new FakeStorage();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: RunsStore, useValue: store },
        { provide: AttachmentStorage, useValue: storage },
        ResultsService,
      ],
    }).compile();
    service = moduleRef.get(ResultsService);
  });

  describe('createResult', () => {
    it('records a result, bumps the item and the run, and returns the resource', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const itemBefore = item.updated_at.getTime();
      const runBefore = run.updated_at.getTime();

      const result = await service.createResult(AS('admin'), run.id, item.id, {
        status: 'passed',
        comment: ' looks good ',
        elapsed_minutes: 5,
      });

      expect(result).toMatchObject({
        run_item_id: item.id,
        status: 'passed',
        comment: 'looks good',
        elapsed_minutes: 5,
        defect_url: null,
        attachments: [],
        created_by: 'u-admin',
      });
      expect(store.results).toHaveLength(1);
      expect(store.items[0]!.updated_at.getTime()).toBeGreaterThan(itemBefore);
      expect(store.runs[0]!.updated_at.getTime()).toBeGreaterThan(runBefore);
    });

    it('400s a failed result without a comment, naming the comment field', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      await expect(
        service.createResult(AS('admin'), run.id, item.id, { status: 'failed' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'comment', issue: expect.any(String) }],
      });
      // A whitespace-only comment is empty, not evidence.
      await expectCode(
        service.createResult(AS('admin'), run.id, item.id, { status: 'failed', comment: '   ' }),
        'VALIDATION_ERROR',
      );
      expect(store.results).toHaveLength(0);
    });

    it('409s a completed run and 409s an archived project', async () => {
      const closed = store.addRun({ completedAt: new Date() });
      const closedItem = store.addItem(closed.id);
      await expectCode(
        service.createResult(AS('admin'), closed.id, closedItem.id, { status: 'passed' }),
        'CONFLICT',
      );

      const archived = store.addRun({ projectId: 'p-arch' });
      const archivedItem = store.addItem(archived.id);
      await expectCode(
        service.createResult(AS('admin'), archived.id, archivedItem.id, { status: 'passed' }),
        'CONFLICT',
      );
    });

    it('lets a Tester record only on their own item (403 otherwise)', async () => {
      const run = store.addRun();
      const mine = store.addItem(run.id, { assigneeId: 'u-tester' });
      const theirs = store.addItem(run.id, { assigneeId: 'u-lead' });

      await expect(
        service.createResult(AS('tester'), run.id, mine.id, { status: 'passed' }),
      ).resolves.toMatchObject({ status: 'passed' });
      await expectCode(
        service.createResult(AS('tester'), run.id, theirs.id, { status: 'passed' }),
        'FORBIDDEN',
      );
    });

    it('404s an unknown run or item', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      await expectCode(
        service.createResult(AS('admin'), 'nope', item.id, { status: 'passed' }),
        'NOT_FOUND',
      );
      await expectCode(
        service.createResult(AS('admin'), run.id, 'nope', { status: 'passed' }),
        'NOT_FOUND',
      );
    });
  });

  describe('listResults', () => {
    it('returns the full history newest-first with attachments and pagination meta', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const first = store.addResult(item.id, { status: 'passed', comment: 'first' });
      const second = store.addResult(item.id, { status: 'failed', comment: 'second' });
      store.addAttachment(second.id, { filename: 'boom.png' });

      const page = await service.listResults(AS('viewer'), run.id, item.id, {});

      expect(page.data.map((row) => row.comment)).toEqual(['second', 'first']);
      expect(page.data[0]!.attachments).toEqual([
        expect.objectContaining({ filename: 'boom.png', content_type: 'image/png' }),
      ]);
      expect(page.data[1]!.id).toBe(first.id);
      expect(page.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
    });

    it('404s an unknown run/item and hides an archived project from non-Admins', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      await expectCode(service.listResults(AS('admin'), 'nope', item.id, {}), 'NOT_FOUND');
      await expectCode(service.listResults(AS('admin'), run.id, 'nope', {}), 'NOT_FOUND');

      const archived = store.addRun({ projectId: 'p-arch' });
      const archivedItem = store.addItem(archived.id);
      await expectCode(
        service.listResults(AS('lead'), archived.id, archivedItem.id, {}),
        'NOT_FOUND',
      );
      await expect(
        service.listResults(AS('admin'), archived.id, archivedItem.id, {}),
      ).resolves.toMatchObject({ data: [] });
    });
  });

  describe('updateResult', () => {
    it('edits the latest result and clears fields with explicit nulls', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed', comment: 'old' });

      const updated = await service.updateResult(AS('admin'), result.id, {
        comment: 'new',
        defect_url: 'https://tracker.example.com/BUG-1',
      });
      expect(updated).toMatchObject({
        comment: 'new',
        defect_url: 'https://tracker.example.com/BUG-1',
      });

      const cleared = await service.updateResult(AS('admin'), result.id, { defect_url: null });
      expect(cleared.defect_url).toBeNull();
    });

    it('400s an empty patch and a failed result left without a comment', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const failed = store.addResult(item.id, { status: 'failed', comment: 'boom' });

      await expectCode(service.updateResult(AS('admin'), failed.id, {}), 'VALIDATION_ERROR');
      await expectCode(
        service.updateResult(AS('admin'), failed.id, { comment: null }),
        'VALIDATION_ERROR',
      );
    });

    it('409s editing a result that is no longer the item latest', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const older = store.addResult(item.id, { status: 'passed' });
      store.addResult(item.id, { status: 'passed' });

      await expectCode(
        service.updateResult(AS('admin'), older.id, { comment: 'late' }),
        'CONFLICT',
      );
    });

    it('lets only the author, an Admin or a Lead edit (403 for another Tester)', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const mine = store.addResult(item.id, { status: 'passed', createdBy: 'u-tester' });

      await expect(
        service.updateResult(AS('tester'), mine.id, { comment: 'mine' }),
      ).resolves.toMatchObject({ comment: 'mine' });
      await expect(
        service.updateResult(AS('lead'), mine.id, { comment: 'lead' }),
      ).resolves.toMatchObject({ comment: 'lead' });
      const other: AuthUser = { ...AS('tester'), id: 'u-tester-2' };
      await expectCode(service.updateResult(other, mine.id, { comment: 'nope' }), 'FORBIDDEN');
    });

    it('404s an unknown result and 409s an archived project', async () => {
      await expectCode(service.updateResult(AS('admin'), 'nope', { comment: 'x' }), 'NOT_FOUND');

      const archived = store.addRun({ projectId: 'p-arch' });
      const item = store.addItem(archived.id);
      const result = store.addResult(item.id, { status: 'passed' });
      await expectCode(
        service.updateResult(AS('admin'), result.id, { comment: 'x' }),
        'CONFLICT',
      );
    });
  });

  describe('uploadAttachment', () => {
    it('writes the bytes then the metadata row and returns the attachment', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed' });

      const attachment = await service.uploadAttachment(AS('admin'), result.id, upload());

      expect(attachment).toMatchObject({
        filename: 'evidence.png',
        content_type: 'image/png',
        size_bytes: 3,
      });
      expect(store.attachments).toHaveLength(1);
      expect([...storage.files.values()]).toEqual([Buffer.from('abc')]);
    });

    it('400s a missing file, a disallowed type, an empty buffer and an oversized file', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed' });

      const expectFile = (promise: Promise<unknown>) =>
        expect(promise).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
          details: [{ field: 'file', issue: expect.any(String) }],
        });

      await expectFile(service.uploadAttachment(AS('admin'), result.id, undefined));
      await expectFile(
        service.uploadAttachment(AS('admin'), result.id, upload({ mimetype: 'application/exe' })),
      );
      await expectFile(
        service.uploadAttachment(AS('admin'), result.id, upload({ buffer: Buffer.alloc(0) })),
      );
      await expectFile(
        service.uploadAttachment(
          AS('admin'),
          result.id,
          upload({ buffer: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1) }),
        ),
      );
      expect(store.attachments).toHaveLength(0);
    });

    it('400s the sixth attachment on a result', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed' });
      for (let index = 0; index < ATTACHMENT_MAX_PER_RESULT; index += 1) {
        store.addAttachment(result.id);
      }

      await expect(
        service.uploadAttachment(AS('admin'), result.id, upload()),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'file', issue: expect.any(String) }],
      });
    });

    it('409s a non-latest result, 403s another Tester, and removes orphaned bytes', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const older = store.addResult(item.id, { status: 'passed', createdBy: 'u-tester' });
      store.addResult(item.id, { status: 'passed' });

      await expectCode(
        service.uploadAttachment(AS('admin'), older.id, upload()),
        'CONFLICT',
      );

      const latest = store.newestResultId(item.id);
      const other: AuthUser = { ...AS('tester'), id: 'u-tester-2' };
      await expectCode(service.uploadAttachment(other, latest, upload()), 'FORBIDDEN');

      // Metadata write fails → the already-written bytes are cleaned up.
      store.failAttachmentInsert = true;
      await expect(
        service.uploadAttachment(AS('admin'), latest, upload()),
      ).rejects.toThrow('metadata write failed');
      expect(storage.files.size).toBe(0);
    });
  });

  describe('getAttachment', () => {
    it('returns the bytes, filename and content type', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed' });
      const attachment = store.addAttachment(result.id, { filename: 'shot.png' });
      storage.files.set(attachment.storage_key, Buffer.from('png'));

      await expect(service.getAttachment(AS('viewer'), attachment.id)).resolves.toEqual({
        bytes: Buffer.from('png'),
        filename: 'shot.png',
        contentType: 'image/png',
      });
    });

    it('404s an unknown attachment, missing bytes and an archived project for non-Admins', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed' });
      const attachment = store.addAttachment(result.id);

      // Metadata row exists but the bytes vanished → 404, never a 500.
      await expectCode(service.getAttachment(AS('admin'), attachment.id), 'NOT_FOUND');
      await expectCode(service.getAttachment(AS('admin'), 'nope'), 'NOT_FOUND');

      const archived = store.addRun({ projectId: 'p-arch' });
      const archivedItem = store.addItem(archived.id);
      const archivedResult = store.addResult(archivedItem.id, { status: 'passed' });
      const archivedAttachment = store.addAttachment(archivedResult.id);
      storage.files.set(archivedAttachment.storage_key, Buffer.from('png'));

      await expectCode(service.getAttachment(AS('lead'), archivedAttachment.id), 'NOT_FOUND');
      await expect(
        service.getAttachment(AS('admin'), archivedAttachment.id),
      ).resolves.toMatchObject({ filename: 'evidence.png' });
    });
  });

  describe('deleteAttachment', () => {
    it('deletes the row then the bytes', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const result = store.addResult(item.id, { status: 'passed' });
      const attachment = store.addAttachment(result.id);
      storage.files.set(attachment.storage_key, Buffer.from('png'));

      await service.deleteAttachment(AS('admin'), attachment.id);

      expect(store.attachments).toHaveLength(0);
      expect(storage.removed).toContain(attachment.storage_key);
    });

    it('409s a non-latest result, 403s another Tester and 404s an unknown id', async () => {
      const run = store.addRun();
      const item = store.addItem(run.id);
      const older = store.addResult(item.id, { status: 'passed', createdBy: 'u-tester' });
      const attachment = store.addAttachment(older.id);
      store.addResult(item.id, { status: 'passed' });

      await expectCode(service.deleteAttachment(AS('admin'), attachment.id), 'CONFLICT');

      // Latest again: now authorise by the result's author.
      store.results = store.results.filter((row) => row.id !== store.newestResultId(item.id));
      const other: AuthUser = { ...AS('tester'), id: 'u-tester-2' };
      await expectCode(service.deleteAttachment(other, attachment.id), 'FORBIDDEN');
      await expectCode(service.deleteAttachment(AS('admin'), 'nope'), 'NOT_FOUND');
    });
  });
});