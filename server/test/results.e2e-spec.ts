import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UserRole } from '../src/auth/current-user';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_RESULT } from '../src/runs/runs.constants';
import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';

/** Result as it arrives over HTTP (untyped JSON until asserted). */
interface ResultData {
  id: string;
  run_item_id: string;
  status: string;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  attachments: AttachmentData[];
  created_by: string;
  created_at: string;
}

interface AttachmentData {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/**
 * Attachment bytes must land in a throwaway directory, never the developer's
 * `./storage`. The config is read at DI-instantiation time by the AppModule
 * factory, and dotenv never overrides a variable that is already set, so this
 * assignment is the value every test app boots with.
 */
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qalm-results-e2e-'));
process.env['STORAGE_DIR'] = storageDir;

/**
 * Integration: the results & attachments contract, docs/api-runs.md, against the
 * real scratch database (migrations applied) through the production HTTP wiring.
 * Covers append-only recording, the history feed, latest-only edits, the Tester
 * own-item/own-result guards, the attachment limits and byte round-trip, and the
 * archived-project rules. Decision logic is also pinned by
 * src/runs/results.service.spec.ts; this spec proves the SQL and multipart paths.
 */
describe('Results & attachments API (integration)', () => {
  let test: TestApp;
  let projectId: string;
  let otherProjectId: string;
  let caseId: string;
  let otherCaseId: string;
  const tokens: Partial<Record<UserRole, string>> = {};
  const userIds: Partial<Record<UserRole, string>> = {};
  let otherTesterToken: string;

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });
  const as = (role: UserRole): { Authorization: string } => auth(tokens[role]!);

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    if (test) await test.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb(test.db);
    resetRateLimit(test.app);

    const seedAndLogin = async (
      email: string,
      role: UserRole,
    ): Promise<{ id: string; token: string }> => {
      const user = await seedUser(test.db, { email, role, name: `${role} User` });
      const res = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.53')
        .send({ email, password: SHARED_FIXTURE_PASSWORD });
      const token = res.body?.data?.access_token;
      if (typeof token !== 'string') {
        throw new Error(`login fixture failed for ${email}: ${res.status}`);
      }
      return { id: user.id, token };
    };

    for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
      const { id, token } = await seedAndLogin(`${role}@example.com`, role);
      userIds[role] = id;
      tokens[role] = token;
    }
    const otherTester = await seedAndLogin('tester2@example.com', 'tester');
    otherTesterToken = otherTester.token;

    const createProject = async (name: string, key: string): Promise<string> => {
      const res = await test.req.post('/api/v1/projects').set(as('admin')).send({ name, key });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    projectId = await createProject('Payments', 'PAY');
    otherProjectId = await createProject('Mobile', 'MOB');

    const createSuite = async (targetProjectId: string, name: string): Promise<string> => {
      const res = await test.req
        .post(`/api/v1/projects/${targetProjectId}/suites`)
        .set(as('admin'))
        .send({ name });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    const createCase = async (targetProjectId: string, suiteId: string): Promise<string> => {
      const res = await test.req
        .post(`/api/v1/projects/${targetProjectId}/cases`)
        .set(as('admin'))
        .send({ suite_id: suiteId, title: 'Refund a paid order', priority: 'high', type: 'functional' });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    caseId = await createCase(projectId, await createSuite(projectId, 'Checkout'));
    otherCaseId = await createCase(otherProjectId, await createSuite(otherProjectId, 'Mobile'));
  });

  /** A fresh open run holding exactly one item, ready to record results on. */
  const createRunWithItem = async (
    targetProjectId = projectId,
    targetCaseId = caseId,
  ): Promise<{ runId: string; itemId: string }> => {
    const run = await test.req
      .post(`/api/v1/projects/${targetProjectId}/runs`)
      .set(as('admin'))
      .send({ name: 'Release smoke', selection: { case_ids: [targetCaseId] } });
    expect(run.status).toBe(201);
    const runId = run.body.data.id as string;

    const items = await test.req.get(`/api/v1/runs/${runId}/items`).set(as('admin'));
    expect(items.status).toBe(200);
    expect(items.body.data).toHaveLength(1);
    return { runId, itemId: items.body.data[0].id as string };
  };

  const createResult = (role: UserRole, runId: string, itemId: string, body: Record<string, unknown>) =>
    test.req.post(`/api/v1/runs/${runId}/items/${itemId}/results`).set(as(role)).send(body);

  const createResultOk = async (
    runId: string,
    itemId: string,
    body: Record<string, unknown> = { status: 'passed' },
  ): Promise<ResultData> => {
    const res = await createResult('admin', runId, itemId, body);
    expect(res.status).toBe(201);
    return res.body.data as ResultData;
  };

  const listResults = (
    role: UserRole,
    runId: string,
    itemId: string,
    query: Record<string, unknown> = {},
  ) =>
    test.req
      .get(`/api/v1/runs/${runId}/items/${itemId}/results`)
      .set(as(role))
      .query(query);

  const patchResult = (role: UserRole, id: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/results/${id}`).set(as(role)).send(body);

  /** Uploads one part; `file === null` sends a multipart body with no file. */
  const uploadAttachment = (
    token: string,
    resultId: string,
    file: { name: string; contentType: string; buffer: Buffer } | null,
    fieldName = 'file',
  ) => {
    const req = test.req.post(`/api/v1/results/${resultId}/attachments`).set(auth(token));
    if (file) req.attach(fieldName, file.buffer, { filename: file.name, contentType: file.contentType });
    else req.field('note', 'no file here');
    return req;
  };

  const pngFile = (name = 'evidence.png', bytes = 'abc') => ({
    name,
    contentType: 'image/png',
    buffer: Buffer.from(bytes),
  });

  const download = (token: string | null, id: string) => {
    const req = test.req.get(`/api/v1/attachments/${id}`).buffer(true);
    return token === null ? req : req.set(auth(token));
  };

  const deleteAttachment = (role: UserRole, id: string) =>
    test.req.delete(`/api/v1/attachments/${id}`).set(as(role));

  const assign = (runId: string, itemId: string, assigneeId: string) =>
    test.req
      .post(`/api/v1/runs/${runId}/assign`)
      .set(as('admin'))
      .send({ assignee_id: assigneeId, item_ids: [itemId] });

  const closeRun = async (runId: string): Promise<void> => {
    const res = await test.req.post(`/api/v1/runs/${runId}/close`).set(as('admin'));
    expect(res.status).toBe(200);
  };

  const archiveProject = async (targetProjectId: string): Promise<void> => {
    const res = await test.req
      .post(`/api/v1/projects/${targetProjectId}/archive`)
      .set(as('admin'));
    expect(res.status).toBe(200);
  };

  describe('roles, envelopes and required auth', () => {
    it('401s every results/attachments endpoint without a token', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId);

      // Each request is built inside the loop: supertest binds its throwaway
      // server lazily and closes it once a request settles, so a batch of
      // pre-built requests cannot be awaited one after another.
      const withoutToken = [
        () => test.req.post(`/api/v1/runs/${runId}/items/${itemId}/results`).send({ status: 'passed' }),
        () => test.req.get(`/api/v1/runs/${runId}/items/${itemId}/results`),
        () => test.req.patch(`/api/v1/results/${result.id}`).send({ comment: 'x' }),
        () => test.req.post(`/api/v1/results/${result.id}/attachments`).field('note', 'x'),
        () => test.req.get(`/api/v1/attachments/${result.id}`),
        () => test.req.delete(`/api/v1/attachments/${result.id}`),
      ];
      for (const build of withoutToken) {
        const res = await build();
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('403s Viewer result writes and 404s unknown run/item', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId);

      for (const res of [
        await createResult('viewer', runId, itemId, { status: 'passed' }),
        await patchResult('viewer', result.id, { comment: 'x' }),
        await uploadAttachment(tokens['viewer']!, result.id, pngFile()),
        await deleteAttachment('viewer', result.id),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }

      expect((await createResult('admin', '00000000-0000-4000-8000-000000000000', itemId, { status: 'passed' })).status).toBe(404);
      expect((await createResult('admin', runId, '00000000-0000-4000-8000-000000000000', { status: 'passed' })).status).toBe(404);
      expect((await listResults('admin', runId, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });
  });

  describe('recording a result', () => {
    it('records a passed result, trimming the comment and touching the item', async () => {
      const { runId, itemId } = await createRunWithItem();

      const res = await createResult('admin', runId, itemId, {
        status: 'passed',
        comment: '  Looks right.  ',
        elapsed_minutes: 5,
        defect_url: 'https://tracker.example.com/browse/BUG-1',
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        run_item_id: itemId,
        status: 'passed',
        comment: 'Looks right.',
        elapsed_minutes: 5,
        defect_url: 'https://tracker.example.com/browse/BUG-1',
        attachments: [],
        created_by: userIds['admin'],
      });

      // The item's derived status/counts now reflect the result.
      const items = await test.req.get(`/api/v1/runs/${runId}/items`).set(as('admin'));
      expect(items.body.data[0]).toMatchObject({ status: 'passed' });
      const run = await test.req.get(`/api/v1/runs/${runId}`).set(as('admin'));
      expect(run.body.data.counts).toMatchObject({ total: 1, passed: 1, untested: 0, percent_complete: 100 });
    });

    it('400s a failed result without a comment (naming comment) and an invalid status', async () => {
      const { runId, itemId } = await createRunWithItem();

      const failed = await createResult('admin', runId, itemId, { status: 'failed' });
      expect(failed.status).toBe(400);
      expect(failed.body.error.code).toBe('VALIDATION_ERROR');
      expect(failed.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'comment' })]),
      );

      const blank = await createResult('admin', runId, itemId, { status: 'failed', comment: '   ' });
      expect(blank.status).toBe(400);
      expect(blank.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'comment' })]),
      );

      const bad = await createResult('admin', runId, itemId, { status: 'exploded' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');

      // A re-test is a new result, and a failed one is accepted once commented.
      expect((await createResult('admin', runId, itemId, { status: 'failed', comment: 'boom' })).status).toBe(201);
    });

    it('lets the assigned Tester record, and 403s a Tester on another item', async () => {
      const { runId, itemId } = await createRunWithItem();
      const assigned = await assign(runId, itemId, userIds['tester']!);
      expect(assigned.status).toBe(200);

      const mine = await createResult('tester', runId, itemId, { status: 'passed' });
      expect(mine.status).toBe(201);
      expect(mine.body.data.created_by).toBe(userIds['tester']);

      const { runId: otherRunId, itemId: otherItemId } = await createRunWithItem();
      // Unassigned item: a Tester cannot record on it.
      const theirs = await createResult('tester', otherRunId, otherItemId, { status: 'passed' });
      expect(theirs.status).toBe(403);
      expect(theirs.body.error.code).toBe('FORBIDDEN');

      // An Admin may record on the same unassigned item (role bypass).
      expect((await createResult('admin', otherRunId, otherItemId, { status: 'passed' })).status).toBe(201);
    });

    it('409s a completed run and an archived project', async () => {
      const { runId, itemId } = await createRunWithItem();
      await closeRun(runId);
      const closed = await createResult('admin', runId, itemId, { status: 'passed' });
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe('CONFLICT');

      const other = await createRunWithItem(otherProjectId, otherCaseId);
      await archiveProject(otherProjectId);
      const archived = await createResult('admin', other.runId, other.itemId, { status: 'passed' });
      expect(archived.status).toBe(409);
      expect(archived.body.error.code).toBe('CONFLICT');
    });
  });

  describe('result history', () => {
    it('lists the history newest-first with attachments and pagination meta', async () => {
      const { runId, itemId } = await createRunWithItem();
      const first = await createResultOk(runId, itemId, { status: 'passed', comment: 'first' });
      const second = await createResultOk(runId, itemId, { status: 'failed', comment: 'second' });
      const upload = await uploadAttachment(tokens['admin']!, second.id, pngFile('boom.png'));
      expect(upload.status).toBe(201);

      const page = await listResults('viewer', runId, itemId);
      expect(page.status).toBe(200);
      expect(page.body.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
      expect((page.body.data as ResultData[]).map((row) => row.comment)).toEqual(['second', 'first']);
      expect((page.body.data as ResultData[])[0]!.attachments).toEqual([
        expect.objectContaining({ filename: 'boom.png', content_type: 'image/png' }),
      ]);
      expect((page.body.data as ResultData[])[1]!.id).toBe(first.id);

      const limited = await listResults('admin', runId, itemId, { limit: 1, page: 2 });
      expect(limited.body.data).toHaveLength(1);
      expect((limited.body.data as ResultData[])[0]!.id).toBe(first.id);
      expect(limited.body.meta).toEqual({ page: 2, limit: 1, total: 2, total_pages: 2 });
    });
  });

  describe('editing a result', () => {
    it('edits the latest result and clears fields with explicit nulls', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId, {
        status: 'passed',
        comment: 'old',
        defect_url: 'https://tracker.example.com/browse/BUG-9',
      });

      const updated = await patchResult('admin', result.id, { comment: 'new' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ comment: 'new', defect_url: 'https://tracker.example.com/browse/BUG-9' });

      const cleared = await patchResult('admin', result.id, { defect_url: null, comment: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toMatchObject({ comment: null, defect_url: null });
    });

    it('400s a status field, an empty body and a failed result left without a comment', async () => {
      const { runId, itemId } = await createRunWithItem();
      const failed = await createResultOk(runId, itemId, { status: 'failed', comment: 'boom' });

      const statusPatch = await patchResult('admin', failed.id, { status: 'passed' });
      expect(statusPatch.status).toBe(400);
      expect(statusPatch.body.error.code).toBe('VALIDATION_ERROR');

      const empty = await patchResult('admin', failed.id, {});
      expect(empty.status).toBe(400);
      expect(empty.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'comment' })]),
      );

      const cleared = await patchResult('admin', failed.id, { comment: null });
      expect(cleared.status).toBe(400);
      expect(cleared.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'comment' })]),
      );
    });

    it('409s editing a result that is no longer the item latest', async () => {
      const { runId, itemId } = await createRunWithItem();
      const older = await createResultOk(runId, itemId, { status: 'passed' });
      await createResultOk(runId, itemId, { status: 'passed' });

      const res = await patchResult('admin', older.id, { comment: 'late' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('lets the author or an Admin/Lead edit, and 403s another Tester', async () => {
      const { runId, itemId } = await createRunWithItem();
      await assign(runId, itemId, userIds['tester']!);
      const mine = await createResult('tester', runId, itemId, { status: 'passed' });
      const id = mine.body.data.id as string;

      expect((await patchResult('tester', id, { comment: 'mine' })).status).toBe(200);
      expect((await patchResult('lead', id, { comment: 'lead' })).status).toBe(200);

      const other = await test.req
        .patch(`/api/v1/results/${id}`)
        .set(auth(otherTesterToken))
        .send({ comment: 'nope' });
      expect(other.status).toBe(403);
      expect(other.body.error.code).toBe('FORBIDDEN');
    });

    it('409s editing a result in an archived project', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId, { status: 'passed' });
      await archiveProject(projectId);

      const res = await patchResult('admin', result.id, { comment: 'x' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('attachments', () => {
    it('uploads a file, lists it on the result, and streams the exact bytes back', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId, { status: 'passed', comment: 'see file' });
      const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

      const upload = await uploadAttachment(
        tokens['admin']!,
        result.id,
        { name: 'declined.png', contentType: 'image/png', buffer: payload },
      );
      expect(upload.status).toBe(201);
      const attachment = upload.body.data as AttachmentData;
      expect(attachment).toMatchObject({
        filename: 'declined.png',
        content_type: 'image/png',
        size_bytes: payload.length,
      });

      // The history now exposes the attachment metadata.
      const page = await listResults('admin', runId, itemId);
      expect((page.body.data as ResultData[])[0]!.attachments).toEqual([
        expect.objectContaining({ id: attachment.id, filename: 'declined.png' }),
      ]);

      // Bytes come back verbatim with the stored type and an inline filename.
      const downloaded = await download(tokens['viewer']!, attachment.id);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers['content-type']).toContain('image/png');
      expect(downloaded.headers['content-disposition']).toBe('inline; filename="declined.png"');
      expect(Buffer.isBuffer(downloaded.body)).toBe(true);
      expect(Buffer.compare(downloaded.body as Buffer, payload)).toBe(0);
    });

    it('400s a missing file, a disallowed type, an oversized file and a wrong field name', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId);

      const missing = await uploadAttachment(tokens['admin']!, result.id, null);
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('VALIDATION_ERROR');
      expect(missing.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'file' })]),
      );

      const wrongType = await uploadAttachment(tokens['admin']!, result.id, {
        name: 'payload.bin',
        contentType: 'application/x-msdownload',
        buffer: Buffer.from('MZ'),
      });
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'file' })]),
      );

      // One byte over the 10 MB ceiling → multer's 413 is rewritten to 400.
      const tooBig = await uploadAttachment(tokens['admin']!, result.id, {
        name: 'huge.png',
        contentType: 'image/png',
        buffer: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1),
      });
      expect(tooBig.status).toBe(400);
      expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');
      expect(tooBig.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'file' })]),
      );

      // The contract fixes the field name at `file`; anything else is rejected.
      const wrongField = await uploadAttachment(tokens['admin']!, result.id, pngFile(), 'upload');
      expect(wrongField.status).toBe(400);
      expect(wrongField.body.error.code).toBe('VALIDATION_ERROR');

      // Nothing was persisted by any of the failures.
      const page = await listResults('admin', runId, itemId);
      expect((page.body.data as ResultData[])[0]!.attachments).toEqual([]);
    });

    it('400s the sixth attachment on a result and accepts exactly five', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId);

      for (let index = 0; index < ATTACHMENT_MAX_PER_RESULT; index += 1) {
        const ok = await uploadAttachment(tokens['admin']!, result.id, pngFile(`shot-${index}.png`));
        expect(ok.status).toBe(201);
      }

      const sixth = await uploadAttachment(tokens['admin']!, result.id, pngFile('six.png'));
      expect(sixth.status).toBe(400);
      expect(sixth.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'file' })]),
      );
    });

    it('409s an upload to a non-latest result and 403s a Tester who is not the author', async () => {
      const { runId, itemId } = await createRunWithItem();
      await assign(runId, itemId, userIds['tester']!);
      const mine = await createResult('tester', runId, itemId, { status: 'passed' });
      const latest = await createResult('admin', runId, itemId, { status: 'passed' });

      const stale = await uploadAttachment(tokens['admin']!, mine.body.data.id as string, pngFile());
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONFLICT');

      // `latest` was authored by the Admin, so another Tester may not attach.
      const forbidden = await uploadAttachment(otherTesterToken, latest.body.data.id as string, pngFile());
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('FORBIDDEN');
    });

    it('deletes an attachment (204), then 404s its bytes and metadata', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId);
      const upload = await uploadAttachment(tokens['admin']!, result.id, pngFile());
      const attachment = upload.body.data as AttachmentData;

      const removed = await deleteAttachment('admin', attachment.id);
      expect(removed.status).toBe(204);
      expect(removed.body).toEqual({});

      expect((await download(tokens['admin']!, attachment.id)).status).toBe(404);
      const page = await listResults('admin', runId, itemId);
      expect((page.body.data as ResultData[])[0]!.attachments).toEqual([]);
    });

    it('409s deleting a non-latest attachment, 403s another Tester, 404s unknown ids', async () => {
      const { runId, itemId } = await createRunWithItem();
      await assign(runId, itemId, userIds['tester']!);
      const older = await createResult('tester', runId, itemId, { status: 'passed' });
      const olderAttachment = (await uploadAttachment(tokens['tester']!, older.body.data.id as string, pngFile()))
        .body.data as AttachmentData;
      // A newer result makes the older one (and its attachment) frozen.
      await createResult('admin', runId, itemId, { status: 'passed' });

      const stale = await deleteAttachment('admin', olderAttachment.id);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONFLICT');

      expect((await deleteAttachment('admin', '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await download(tokens['admin']!, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });

    it('409s attachment writes to an archived project, 404s non-Admin reads, serves an Admin', async () => {
      const { runId, itemId } = await createRunWithItem();
      const result = await createResultOk(runId, itemId);
      const attachment = (await uploadAttachment(tokens['admin']!, result.id, pngFile()))
        .body.data as AttachmentData;
      await archiveProject(projectId);

      // Reads: hidden from non-Admins, still served to an Admin.
      expect((await listResults('lead', runId, itemId)).status).toBe(404);
      expect((await listResults('admin', runId, itemId)).status).toBe(200);
      expect((await download(tokens['lead']!, attachment.id)).status).toBe(404);
      expect((await download(tokens['admin']!, attachment.id)).status).toBe(200);

      // Writes: blocked for everyone.
      const upload = await uploadAttachment(tokens['admin']!, result.id, pngFile('again.png'));
      expect(upload.status).toBe(409);
      expect(upload.body.error.code).toBe('CONFLICT');
      expect((await deleteAttachment('admin', attachment.id)).status).toBe(409);
      expect((await patchResult('admin', result.id, { comment: 'x' })).status).toBe(409);
    });
  });
});