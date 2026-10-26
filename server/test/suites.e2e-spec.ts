import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';
import type request from 'supertest';
import { UserRole } from '../src/auth/current-user';

/** Suite resource as it arrives over HTTP (untyped JSON until asserted). */
interface SuiteData {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  depth: number;
  position: number;
  case_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  children?: SuiteData[];
  path?: Array<{ id: string; name: string }>;
}

const treeOf = (res: request.Response): SuiteData[] => res.body.data as SuiteData[];
const names = (nodes: SuiteData[]): string[] => nodes.map((node) => node.name);
const bodyKeys = (res: request.Response): string[] =>
  Object.keys(res.body as Record<string, unknown>).sort();

/**
 * Integration: the full suites contract, docs/api-suites.md, against the real
 * scratch database (migrations applied) through the production HTTP wiring.
 * Covers the PRD-suites-cases.md acceptance criteria for the suite tree
 * (1-5, 11) plus the archived-project rules.
 */
describe('Suites API (integration)', () => {
  let test: TestApp;
  let projectId: string;
  let otherProjectId: string;
  const tokens: Partial<Record<UserRole, string>> = {};
  const userIds: Partial<Record<UserRole, string>> = {};

  const as = (role: UserRole): { Authorization: string } => ({
    Authorization: `Bearer ${tokens[role]}`,
  });

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    if (test) await test.close();
  });

  beforeEach(async () => {
    await resetDb(test.db);
    resetRateLimit(test.app);
    for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
      const email = `${role}@example.com`;
      const user = await seedUser(test.db, { email, role, name: `${role} User` });
      userIds[role] = user.id;
      const res = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.51')
        .send({ email, password: SHARED_FIXTURE_PASSWORD });
      const token = res.body?.data?.access_token;
      if (typeof token !== 'string') {
        throw new Error(`login fixture failed for ${role}: ${res.status}`);
      }
      tokens[role] = token;
    }

    const project = await test.req
      .post('/api/v1/projects')
      .set(as('admin'))
      .send({ name: 'Payments', key: 'PAY' });
    projectId = project.body.data.id as string;
    const other = await test.req
      .post('/api/v1/projects')
      .set(as('admin'))
      .send({ name: 'Mobile', key: 'MOB' });
    otherProjectId = other.body.data.id as string;
  });

  const createSuite = (
    role: UserRole,
    targetProjectId: string,
    body: Record<string, unknown>,
  ) =>
    test.req
      .post(`/api/v1/projects/${targetProjectId}/suites`)
      .set(as(role))
      .send(body);

  const createOk = async (
    name: string,
    parentId: string | null = null,
    targetProjectId = projectId,
  ): Promise<SuiteData> => {
    const res = await createSuite('admin', targetProjectId, { name, parent_id: parentId });
    expect(res.status).toBe(201);
    return res.body.data as SuiteData;
  };

  const tree = async (
    role: UserRole = 'viewer',
    targetProjectId = projectId,
  ): Promise<SuiteData[]> => {
    const res = await test.req
      .get(`/api/v1/projects/${targetProjectId}/suites`)
      .set(as(role));
    expect(res.status).toBe(200);
    return treeOf(res);
  };

  const patchSuite = (role: UserRole, id: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/suites/${id}`).set(as(role)).send(body);

  describe('roles and envelope', () => {
    it('lets every authenticated role read the empty tree', async () => {
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req
          .get(`/api/v1/projects/${projectId}/suites`)
          .set(as(role));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: [] });
      }
    });

    it('403s Tester and Viewer writes, 401s without a token', async () => {
      for (const role of ['tester', 'viewer'] as UserRole[]) {
        const res = await createSuite(role, projectId, { name: 'Nope' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      const anonymous = await test.req
        .post(`/api/v1/projects/${projectId}/suites`)
        .send({ name: 'Nope' });
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('404s an unknown project and 400s a malformed project id', async () => {
      const unknown = await test.req
        .get('/api/v1/projects/018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f/suites')
        .set(as('admin'));
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');

      const malformed = await test.req
        .get('/api/v1/projects/not-a-uuid/suites')
        .set(as('admin'));
      expect(malformed.status).toBe(400);
    });
  });

  describe('POST /projects/:projectId/suites', () => {
    it('creates a root suite: depth 1, appended position, created_by, no children field', async () => {
      const res = await createSuite('lead', projectId, { name: 'Checkout' });
      expect(res.status).toBe(201);
      expect(bodyKeys(res)).toEqual(['data']);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        project_id: projectId,
        parent_id: null,
        name: 'Checkout',
        description: null,
        depth: 1,
        position: 1,
        case_count: 0,
        created_by: userIds['lead'],
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
    });

    it('creates child and grandchild suites (AC1)', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);
      expect([root.depth, child.depth, grandchild.depth]).toEqual([1, 2, 3]);
      expect(child.parent_id).toBe(root.id);
      expect(grandchild.parent_id).toBe(child.id);
    });

    it('400s a 4th level and names parent_id (AC1)', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);
      const res = await createSuite('admin', projectId, { name: 'Too deep', parent_id: grandchild.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'parent_id' })]),
      );
    });

    it('409s a sibling name clash case-insensitively; same name under another parent is fine (AC3)', async () => {
      const root = await createOk('Checkout');
      const second = await createOk('Account');
      await createOk('Payment', root.id);

      const clash = await createSuite('admin', projectId, { name: 'payment', parent_id: root.id });
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('CONFLICT');
      expect(clash.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
      );

      const rootClash = await createSuite('admin', projectId, { name: 'CHECKOUT' });
      expect(rootClash.status).toBe(409);

      const elsewhere = await createSuite('admin', projectId, {
        name: 'Payment',
        parent_id: second.id,
      });
      expect(elsewhere.status).toBe(201);
    });

    it('appends by default and honours an explicit position (AC5 groundwork)', async () => {
      await createOk('Checkout');
      await createOk('Account');
      const appended = await createOk('Reports');
      expect(appended.position).toBe(3);

      const first = await createOk('Inbox', null, projectId);
      expect(first.position).toBe(4);

      // Insert into the middle: everything at/after 2 shifts right.
      const res = await createSuite('admin', projectId, { name: 'Billing', position: 2 });
      expect(res.status).toBe(201);
      expect(res.body.data.position).toBe(2);
      expect(names(await tree())).toEqual(['Checkout', 'Billing', 'Account', 'Reports', 'Inbox']);
    });

    it('400s an explicit position beyond the sibling group', async () => {
      await createOk('Checkout');
      const res = await createSuite('admin', projectId, { name: 'Late', position: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'position' })]),
      );
    });

    it('400s a parent in another project', async () => {
      const foreign = await createOk('Mobile root', null, otherProjectId);
      const res = await createSuite('admin', projectId, {
        name: 'Child',
        parent_id: foreign.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'parent_id' })]),
      );
    });

    it('404s an unknown parent id (VALIDATION_ERROR for the field, not 404)', async () => {
      const res = await createSuite('admin', projectId, {
        name: 'Child',
        parent_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'parent_id' })]),
      );
    });
  });

  describe('GET /projects/:projectId/suites', () => {
    it('returns the whole nested tree ordered by position at every level', async () => {
      const root = await createOk('Checkout');
      await createOk('Account');
      const payment = await createOk('Payment', root.id);
      await createOk('Cart', root.id);
      await createOk('Wallet', payment.id);

      const data = await tree('tester');
      expect(names(data)).toEqual(['Checkout', 'Account']);
      expect(names(data[0]!.children ?? [])).toEqual(['Payment', 'Cart']);
      expect(names(data[0]!.children?.[0]?.children ?? [])).toEqual(['Wallet']);
      expect(data[1]!.children).toEqual([]);
      expect(data[0]!.children?.[0]?.parent_id).toBe(root.id);
    });

    it('case_count is a subtree count that ignores soft-deleted cases', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);

      const insertCase = async (suiteId: string, caseNumber: number, deleted: boolean) => {
        await test.db.query(
          `INSERT INTO cases
             (project_id, suite_id, case_number, title, priority, type, created_by, updated_by, deleted_at)
           VALUES ($1, $2, $3, 'Case', 'high', 'functional', $4, $4, $5)`,
          [projectId, suiteId, caseNumber, userIds['admin'], deleted ? new Date() : null],
        );
      };
      await insertCase(root.id, 1, false);
      await insertCase(grandchild.id, 2, false);
      await insertCase(grandchild.id, 3, true);

      const data = await tree();
      expect(data[0]!.case_count).toBe(2);
      expect(data[0]!.children?.[0]?.case_count).toBe(1);
      expect(data[0]!.children?.[0]?.children?.[0]?.case_count).toBe(1);
    });
  });

  describe('GET /suites/:id', () => {
    it('returns the suite plus its root → self path', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);

      const res = await test.req.get(`/api/v1/suites/${grandchild.id}`).set(as('viewer'));
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Wallet');
      expect(res.body.data.path).toEqual([
        { id: root.id, name: 'Checkout' },
        { id: child.id, name: 'Payment' },
        { id: grandchild.id, name: 'Wallet' },
      ]);
    });

    it('404s an unknown id and 400s a malformed one', async () => {
      const unknown = await test.req
        .get('/api/v1/suites/018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f')
        .set(as('admin'));
      expect(unknown.status).toBe(404);
      const malformed = await test.req.get('/api/v1/suites/nope').set(as('admin'));
      expect(malformed.status).toBe(400);
    });
  });

  describe('PATCH /suites/:id', () => {
    it('renames and clears the description', async () => {
      const suite = await createOk('Checkout');
      const withDescription = await patchSuite('admin', suite.id, { description: 'Cart flows' });
      expect(withDescription.status).toBe(200);
      expect(withDescription.body.data.description).toBe('Cart flows');

      const cleared = await patchSuite('lead', suite.id, {
        name: 'Checkout v2',
        description: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toMatchObject({ name: 'Checkout v2', description: null });
    });

    it('409s a rename clash inside the same parent', async () => {
      const root = await createOk('Checkout');
      await createOk('Payment', root.id);
      const cart = await createOk('Cart', root.id);
      const res = await patchSuite('admin', cart.id, { name: 'payment' });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
      );
    });

    it('400s an empty body', async () => {
      const suite = await createOk('Checkout');
      const res = await patchSuite('admin', suite.id, {});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('moves a subtree to a new parent and rewrites the subtree depth (AC1)', async () => {
      const root = await createOk('Checkout');
      const account = await createOk('Account');
      const payment = await createOk('Payment', root.id);
      const wallet = await createOk('Wallet', payment.id);

      const res = await patchSuite('admin', payment.id, { parent_id: account.id });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ parent_id: account.id, depth: 2, position: 1 });

      const data = await tree();
      const accountNode = data.find((node) => node.id === account.id)!;
      expect(names(accountNode.children ?? [])).toEqual(['Payment']);
      expect(accountNode.children?.[0]?.children?.[0]?.id).toBe(wallet.id);
      expect(accountNode.children?.[0]?.children?.[0]?.depth).toBe(3);
      // The old sibling group is densified.
      const rootNode = data.find((node) => node.id === root.id)!;
      expect(rootNode.children).toEqual([]);
    });

    it('400s a move into itself or its own descendant (AC2)', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);

      const self = await patchSuite('admin', root.id, { parent_id: root.id });
      expect(self.status).toBe(400);
      expect(self.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'parent_id' })]),
      );

      const intoDescendant = await patchSuite('admin', root.id, { parent_id: grandchild.id });
      expect(intoDescendant.status).toBe(400);
      expect(intoDescendant.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'parent_id' })]),
      );
    });

    it('400s a move that would push a subtree past depth 3', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);
      const other = await createOk('Account');
      const otherChild = await createOk('Security', other.id);

      const res = await patchSuite('admin', child.id, { parent_id: otherChild.id });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'parent_id' })]),
      );
      // Nothing moved and the depth is untouched.
      const detail = await test.req.get(`/api/v1/suites/${grandchild.id}`).set(as('admin'));
      expect(detail.body.data.depth).toBe(3);
    });

    it('reorders within the sibling group and closes the gap', async () => {
      const root = await createOk('Checkout');
      const payment = await createOk('Payment', root.id);
      await createOk('Cart', root.id);
      const wallet = await createOk('Wallet', root.id);

      const res = await patchSuite('admin', wallet.id, { position: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.position).toBe(1);

      const data = await tree();
      expect(names(data[0]!.children ?? [])).toEqual(['Wallet', 'Payment', 'Cart']);
      const paymentAfter = await test.req.get(`/api/v1/suites/${payment.id}`).set(as('admin'));
      expect(paymentAfter.body.data.position).toBe(2);
    });

    it('400s a position beyond the group, 404s an unknown suite', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const badPosition = await patchSuite('admin', child.id, { position: 5 });
      expect(badPosition.status).toBe(400);

      const unknown = await patchSuite(
        'admin',
        '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
        { name: 'Ghost' },
      );
      expect(unknown.status).toBe(404);
    });
  });

  describe('PATCH /projects/:projectId/suites/order', () => {
    const reorder = (
      body: Record<string, unknown>,
      role: UserRole = 'admin',
      targetProjectId = projectId,
    ) =>
      test.req
        .patch(`/api/v1/projects/${targetProjectId}/suites/order`)
        .set(as(role))
        .send(body);

    it('rewrites positions atomically and returns the reconciled tree (AC5)', async () => {
      const checkout = await createOk('Checkout');
      const account = await createOk('Account');

      const res = await reorder({
        items: [
          { id: checkout.id, parent_id: null, position: 2 },
          { id: account.id, parent_id: null, position: 1 },
        ],
      });
      expect(res.status).toBe(200);
      expect(names(treeOf(res))).toEqual(['Account', 'Checkout']);

      const data = await tree();
      expect(data.map((node) => [node.name, node.position])).toEqual([
        ['Account', 1],
        ['Checkout', 2],
      ]);
    });

    it('reparents and re-densifies the group it left', async () => {
      const root = await createOk('Checkout');
      const payment = await createOk('Payment', root.id);
      const cart = await createOk('Cart', root.id);
      const account = await createOk('Account');

      const res = await reorder({
        items: [{ id: cart.id, parent_id: account.id, position: 1 }],
      });
      expect(res.status).toBe(200);
      expect(names(treeOf(res)[0]!.children ?? [])).toEqual(['Payment']);
      expect(names(treeOf(res)[1]!.children ?? [])).toEqual(['Cart']);
      expect(payment.position).toBe(1);
    });

    it('400s unknown ids, cross-project parents, duplicate positions and cycles', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);
      const grandchild = await createOk('Wallet', child.id);
      const account = await createOk('Account');
      const security = await createOk('Security', account.id);
      const foreign = await createOk('Mobile root', null, otherProjectId);

      const unknown = await reorder({ items: [{ id: 'x', parent_id: null, position: 1 }] });
      expect(unknown.status).toBe(400);

      const crossProject = await reorder({
        items: [{ id: root.id, parent_id: foreign.id, position: 1 }],
      });
      expect(crossProject.status).toBe(400);

      const duplicates = await reorder({
        items: [
          { id: root.id, parent_id: null, position: 1 },
          { id: child.id, parent_id: null, position: 1 },
        ],
      });
      expect(duplicates.status).toBe(400);

      const cycle = await reorder({
        items: [{ id: root.id, parent_id: grandchild.id, position: 1 }],
      });
      expect(cycle.status).toBe(400);

      // Payment carries Wallet (height 1); Security is already depth 2 → 4.
      const tooDeep = await reorder({
        items: [{ id: child.id, parent_id: security.id, position: 1 }],
      });
      expect(tooDeep.status).toBe(400);
      expect(tooDeep.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'items' })]),
      );
    });

    it('403s Tester and 400s an empty items array', async () => {
      const denied = await reorder({ items: [] }, 'tester');
      expect(denied.status).toBe(403);
      const empty = await reorder({ items: [] });
      expect(empty.status).toBe(400);
    });
  });

  describe('DELETE /suites/:id', () => {
    it('204s an empty suite and removes it from the tree (AC4)', async () => {
      await createOk('Checkout');
      const empty = await createOk('Temporary');
      const res = await test.req.delete(`/api/v1/suites/${empty.id}`).set(as('admin'));
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(names(await tree())).toEqual(['Checkout']);
    });

    it('closes the position gap after a delete', async () => {
      const root = await createOk('Checkout');
      await createOk('Payment', root.id);
      const cart = await createOk('Cart', root.id);
      await createOk('Wallet', root.id);

      const res = await test.req.delete(`/api/v1/suites/${cart.id}`).set(as('admin'));
      expect(res.status).toBe(204);
      const data = await tree();
      expect(names(data[0]!.children ?? [])).toEqual(['Payment', 'Wallet']);
      const wallet = data[0]!.children?.find((node) => node.name === 'Wallet');
      expect(wallet?.position).toBe(2);
    });

    it('409s a suite with child suites or live cases (AC4)', async () => {
      const root = await createOk('Checkout');
      const child = await createOk('Payment', root.id);

      const withChildren = await test.req.delete(`/api/v1/suites/${root.id}`).set(as('admin'));
      expect(withChildren.status).toBe(409);
      expect(withChildren.body.error.code).toBe('CONFLICT');
      expect(withChildren.body.error.details).toEqual([
        { field: 'suite', issue: 'suite has 1 child suites' },
      ]);

      await test.db.query(
        `INSERT INTO cases
           (project_id, suite_id, case_number, title, priority, type, created_by, updated_by)
         VALUES ($1, $2, 1, 'Case', 'high', 'functional', $3, $3)`,
        [projectId, child.id, userIds['admin']],
      );
      const withCases = await test.req.delete(`/api/v1/suites/${child.id}`).set(as('admin'));
      expect(withCases.status).toBe(409);
      expect(withCases.body.error.details).toEqual([{ field: 'suite', issue: 'suite has 1 cases' }]);
    });

    it('deletes a suite whose cases are all soft-deleted', async () => {
      const suite = await createOk('Checkout');
      await test.db.query(
        `INSERT INTO cases
           (project_id, suite_id, case_number, title, priority, type, created_by, updated_by, deleted_at)
         VALUES ($1, $2, 1, 'Gone', 'high', 'functional', $3, $3, now())`,
        [projectId, suite.id, userIds['admin']],
      );
      const res = await test.req.delete(`/api/v1/suites/${suite.id}`).set(as('admin'));
      expect(res.status).toBe(204);
    });

    it('404s an unknown id, 403s a Tester', async () => {
      const suite = await createOk('Checkout');
      const denied = await test.req.delete(`/api/v1/suites/${suite.id}`).set(as('tester'));
      expect(denied.status).toBe(403);
      const unknown = await test.req
        .delete('/api/v1/suites/018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f')
        .set(as('admin'));
      expect(unknown.status).toBe(404);
    });
  });

  describe('archived project', () => {
    const archive = async (): Promise<void> => {
      const res = await test.req
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(as('admin'));
      expect(res.status).toBe(200);
    };

    it('409s every suite write, including for an Admin', async () => {
      const suite = await createOk('Checkout');
      await archive();

      const create = await createSuite('admin', projectId, { name: 'Nope' });
      expect(create.status).toBe(409);
      expect(create.body.error.code).toBe('CONFLICT');

      const patch = await patchSuite('admin', suite.id, { name: 'Nope' });
      expect(patch.status).toBe(409);

      const reorder = await test.req
        .patch(`/api/v1/projects/${projectId}/suites/order`)
        .set(as('lead'))
        .send({ items: [{ id: suite.id, parent_id: null, position: 1 }] });
      expect(reorder.status).toBe(409);

      const remove = await test.req.delete(`/api/v1/suites/${suite.id}`).set(as('admin'));
      expect(remove.status).toBe(409);
    });

    it('404s suite reads for non-Admins and serves them to an Admin', async () => {
      const suite = await createOk('Checkout');
      await archive();

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const tree = await test.req
          .get(`/api/v1/projects/${projectId}/suites`)
          .set(as(role));
        expect(tree.status).toBe(404);
        const detail = await test.req.get(`/api/v1/suites/${suite.id}`).set(as(role));
        expect(detail.status).toBe(404);
      }

      const adminTree = await test.req
        .get(`/api/v1/projects/${projectId}/suites`)
        .set(as('admin'));
      expect(adminTree.status).toBe(200);
      expect(names(treeOf(adminTree))).toEqual(['Checkout']);
    });
  });
});
