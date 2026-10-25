import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { CreateSuiteDto, ReorderSuitesDto, UpdateSuiteDto } from './dto';
import {
  arrangeSiblings,
  buildSuitePath,
  buildSuiteTree,
  isDescendantOf,
  rollupCaseCounts,
  subtreeHeight,
  toCountMap,
} from './suite-tree';
import { MAX_SUITE_DEPTH } from './suites.constants';
import { Queryable, SuiteRow, SuitesStore, suiteNameConflict } from './suites.store';
import { SuiteDetailDto, SuiteDto, SuiteTreeNode, toSuiteDto } from './suites.types';

function validationError(field: string, issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', 'Request validation failed.', [{ field, issue }]);
}

function suiteNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Suite not found.');
}

/**
 * Business rules for the suites endpoints, docs/api-suites.md. Role checks are
 * in the controller (@Roles + AuthGuard); this service owns depth, sibling
 * ordering, archived-project rules and the non-empty delete block.
 */
@Injectable()
export class SuitesService {
  constructor(@Inject(SuitesStore) private readonly store: SuitesStore) {}

  /** Whole project tree, nested, ordered by position at every level. */
  async tree(caller: AuthUser, projectId: string): Promise<SuiteTreeNode[]> {
    await this.requireProject(projectId, caller, 'read');
    return this.loadTree(projectId);
  }

  async create(caller: AuthUser, projectId: string, dto: CreateSuiteDto): Promise<SuiteDto> {
    await this.requireProject(projectId, caller, 'write');
    return this.store.transaction(async (client) => {
      const parent = dto.parent_id ? await this.requireParent(projectId, dto.parent_id, client) : null;
      const depth = parent === null ? 1 : parent.depth + 1;
      if (depth > MAX_SUITE_DEPTH) {
        throw validationError('parent_id', `suites are limited to ${MAX_SUITE_DEPTH} levels`);
      }
      const parentId = dto.parent_id ?? null;

      const clash = await this.store.findIdBySiblingName(
        projectId,
        parentId,
        dto.name,
        null,
        client,
      );
      if (clash !== null) throw suiteNameConflict(parentId);

      const siblings = await this.store.countSiblings(projectId, parentId, client);
      let position = siblings + 1;
      if (dto.position !== undefined) {
        if (dto.position > siblings + 1) {
          throw validationError('position', `must be between 1 and ${siblings + 1}`);
        }
        position = dto.position;
        await this.store.shiftPositions(projectId, parentId, position, 1, client);
      }

      const row = await this.store.insert(
        {
          project_id: projectId,
          parent_id: parentId,
          name: dto.name,
          description: dto.description ?? null,
          depth,
          position,
          created_by: caller.id,
        },
        client,
      );
      return toSuiteDto(row, 0);
    });
  }

  /** Single suite plus its root → self breadcrumb trail. */
  async detail(caller: AuthUser, id: string): Promise<SuiteDetailDto> {
    const suite = await this.requireSuite(id);
    await this.requireProject(suite.project_id, caller, 'read');
    const rows = await this.store.listByProject(suite.project_id);
    const direct = await this.store.liveCaseCountsByProject(suite.project_id);
    const counts = rollupCaseCounts(rows, toCountMap(direct));
    const current = rows.find((row) => row.id === id) ?? suite;
    return { ...toSuiteDto(current, counts.get(id) ?? 0), path: buildSuitePath(rows, id) };
  }

  /**
   * Rename, re-describe, reorder or move. A move rewrites the depth of the
   * whole subtree and closes/opens position slots in both sibling groups in
   * the same transaction (docs/api-suites.md § PATCH).
   */
  async update(caller: AuthUser, id: string, dto: UpdateSuiteDto): Promise<SuiteDto> {
    const existing = await this.requireSuite(id);
    await this.requireProject(existing.project_id, caller, 'write');
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.parent_id === undefined &&
      dto.position === undefined
    ) {
      throw new ApiError('VALIDATION_ERROR', 'Provide at least one field to update.', [
        { field: 'name', issue: 'at least one field must be provided' },
        { field: 'description', issue: 'at least one field must be provided' },
        { field: 'parent_id', issue: 'at least one field must be provided' },
        { field: 'position', issue: 'at least one field must be provided' },
      ]);
    }

    return this.store.transaction(async (client) => {
      const row = await this.store.findByIdForUpdate(id, client);
      if (!row) throw suiteNotFound();

      const parentId = dto.parent_id === undefined ? row.parent_id : dto.parent_id;
      const parent =
        parentId === null ? null : await this.requireParent(row.project_id, parentId, client);
      const parentChanged = parentId !== row.parent_id;
      const name = dto.name ?? row.name;

      if (parentChanged) {
        if (parentId === row.id) {
          throw validationError('parent_id', 'a suite cannot be its own parent');
        }
        if (parentId !== null) {
          const tree = await this.store.listByProject(row.project_id, client);
          if (isDescendantOf(tree, parentId, row.id)) {
            throw validationError('parent_id', 'cannot move a suite into its own descendant');
          }
          const height = subtreeHeight(tree, row.id);
          const newParentDepth = parent?.depth ?? 0;
          if (newParentDepth + 1 + height > MAX_SUITE_DEPTH) {
            throw validationError(
              'parent_id',
              `a move would exceed the ${MAX_SUITE_DEPTH}-level limit`,
            );
          }
        }
      }

      if (name !== row.name || parentChanged) {
        const clash = await this.store.findIdBySiblingName(
          row.project_id,
          parentId,
          name,
          row.id,
          client,
        );
        if (clash !== null) throw suiteNameConflict(parentId);
      }

      const siblings = (
        await this.store.listSiblings(row.project_id, parentId, client)
      ).filter((sibling) => sibling.id !== row.id);

      let position = row.position;
      if (parentChanged || dto.position !== undefined) {
        position = dto.position ?? siblings.length + 1;
        if (position < 1 || position > siblings.length + 1) {
          throw validationError('position', `must be between 1 and ${siblings.length + 1}`);
        }
      }

      if (dto.name === null) throw validationError('name', 'must be a string');
      const fields: {
        name?: string;
        description?: string | null;
        parent_id?: string | null;
        position?: number;
      } = {};
      if (dto.name !== undefined) fields.name = dto.name;
      if (dto.description !== undefined) fields.description = dto.description;

      if (parentChanged) {
        fields.parent_id = parentId;
        fields.position = position;
        // Close the gap in the old group, open a slot in the new one.
        await this.store.shiftPositions(row.project_id, row.parent_id, row.position + 1, -1, client);
        if (position <= siblings.length) {
          await this.store.shiftPositions(row.project_id, parentId, position, 1, client);
        }
        await this.store.updateFields(row.id, fields, client);
        const depth = (parent?.depth ?? 0) + 1;
        await this.store.updateSubtreeDepth(row.id, depth - row.depth, client);
      } else if (dto.position !== undefined && position !== row.position) {
        const order = arrangeSiblings(
          siblings.map((sibling) => sibling.id),
          [{ id: row.id, position }],
        );
        if (order === null) {
          throw validationError('position', 'is beyond the end of the sibling group');
        }
        await this.store.setPositions(
          order.map((suiteId, index) => ({ id: suiteId, position: index + 1 })),
          client,
        );
        if (Object.keys(fields).length > 0) await this.store.updateFields(row.id, fields, client);
        else await this.store.touch(row.id, client);
      } else if (Object.keys(fields).length > 0) {
        await this.store.updateFields(row.id, fields, client);
      } else {
        await this.store.touch(row.id, client);
      }

      const after = await this.store.findById(id, client);
      if (!after) throw suiteNotFound();
      const rows = await this.store.listByProject(row.project_id, client);
      const direct = await this.store.liveCaseCountsByProject(row.project_id, client);
      const counts = rollupCaseCounts(rows, toCountMap(direct));
      return toSuiteDto(after, counts.get(id) ?? 0);
    });
  }

  /**
   * Atomic drag-and-drop reorder. Every submitted item is placed at its
   * position inside its (possibly new) sibling group; groups that only lose
   * members are re-densified. Depths are recomputed for the whole project
   * from the final parent links, so a chain of moves cannot drift.
   */
  async reorder(
    caller: AuthUser,
    projectId: string,
    dto: ReorderSuitesDto,
  ): Promise<SuiteTreeNode[]> {
    await this.requireProject(projectId, caller, 'write');
    return this.store.transaction(async (client) => {
      const rows = await this.store.listForUpdate(projectId, client);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const finalParent = new Map<string, string | null>();
      for (const row of rows) finalParent.set(row.id, row.parent_id);

      const incomingByGroup = new Map<string | null, Array<{ id: string; position: number }>>();
      const seen = new Set<string>();
      for (const item of dto.items) {
        if (seen.has(item.id)) {
          throw validationError('items', `duplicate suite id ${item.id}`);
        }
        seen.add(item.id);
        if (!byId.has(item.id)) {
          throw validationError('items', `suite ${item.id} is not in this project`);
        }
        const parentId = item.parent_id ?? null;
        if (parentId !== null && !byId.has(parentId)) {
          throw validationError('items', `parent ${parentId} is not in this project`);
        }
        if (parentId === item.id) {
          throw validationError('items', 'a suite cannot be its own parent');
        }
        finalParent.set(item.id, parentId);
        const group = incomingByGroup.get(parentId) ?? [];
        group.push({ id: item.id, position: item.position });
        incomingByGroup.set(parentId, group);
      }

      for (const group of incomingByGroup.values()) {
        const positions = new Set<number>();
        for (const item of group) {
          if (positions.has(item.position)) {
            throw validationError(
              'items',
              `duplicate position ${item.position} in the same sibling group`,
            );
          }
          positions.add(item.position);
        }
      }

      // Depth from the final parent links; a cycle means "into its own descendant".
      const depthOf = new Map<string, number>();
      const resolveDepth = (id: string, trail: Set<string>): number => {
        const cached = depthOf.get(id);
        if (cached !== undefined) return cached;
        const parentId = finalParent.get(id) ?? null;
        if (parentId === null) {
          depthOf.set(id, 1);
          return 1;
        }
        if (trail.has(id)) {
          throw validationError('items', 'a suite cannot be moved into its own descendant');
        }
        trail.add(id);
        const depth = resolveDepth(parentId, trail) + 1;
        trail.delete(id);
        depthOf.set(id, depth);
        return depth;
      };
      for (const row of rows) {
        if (resolveDepth(row.id, new Set()) > MAX_SUITE_DEPTH) {
          throw validationError('items', `a move would exceed the ${MAX_SUITE_DEPTH}-level limit`);
        }
      }

      const affected = new Set<string | null>();
      for (const item of dto.items) {
        affected.add(item.parent_id ?? null);
        affected.add(byId.get(item.id)?.parent_id ?? null);
      }

      const nextPosition = new Map<string, number>();
      for (const groupParent of affected) {
        const members = rows.filter((row) => finalParent.get(row.id) === groupParent);
        const incoming = incomingByGroup.get(groupParent) ?? [];
        const incomingIds = new Set(incoming.map((item) => item.id));
        const existing = members
          .filter((row) => !incomingIds.has(row.id))
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((row) => row.id);
        const order = arrangeSiblings(existing, incoming);
        if (order === null) {
          throw validationError('items', 'position is beyond the end of its sibling group');
        }
        order.forEach((suiteId, index) => nextPosition.set(suiteId, index + 1));
      }

      const changed: Array<{
        id: string;
        parent_id: string | null;
        depth: number;
        position: number;
      }> = [];
      for (const row of rows) {
        const parentId = finalParent.get(row.id) ?? null;
        const depth = depthOf.get(row.id) ?? row.depth;
        const position = nextPosition.get(row.id) ?? row.position;
        if (parentId !== row.parent_id || depth !== row.depth || position !== row.position) {
          changed.push({ id: row.id, parent_id: parentId, depth, position });
        }
      }
      await this.store.applyLayout(changed, client);
      return this.loadTree(projectId, client);
    });
  }

  /** Delete is only allowed on an empty suite (no children, no live cases). */
  async remove(caller: AuthUser, id: string): Promise<void> {
    const suite = await this.requireSuite(id);
    await this.requireProject(suite.project_id, caller, 'write');
    await this.store.transaction(async (client) => {
      const row = await this.store.findByIdForUpdate(id, client);
      if (!row) throw suiteNotFound();

      const children = await this.store.countChildren(id, client);
      if (children > 0) {
        throw new ApiError('CONFLICT', 'Suite is not empty.', [
          { field: 'suite', issue: `suite has ${children} child suites` },
        ]);
      }
      const cases = await this.store.countLiveCases(id, client);
      if (cases > 0) {
        throw new ApiError('CONFLICT', 'Suite is not empty.', [
          { field: 'suite', issue: `suite has ${cases} cases` },
        ]);
      }

      await this.store.deleteById(id, client);
      await this.store.shiftPositions(row.project_id, row.parent_id, row.position + 1, -1, client);
    });
  }

  /**
   * Contract visibility: unknown project → 404; archived project → 404 for
   * non-Admins on reads and 409 on every write (PRD § Delete semantics).
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

  private async requireSuite(id: string): Promise<SuiteRow> {
    const suite = await this.store.findById(id);
    if (!suite) throw suiteNotFound();
    return suite;
  }

  private async requireParent(
    projectId: string,
    parentId: string,
    q?: Queryable,
  ): Promise<SuiteRow> {
    const parent = await this.store.findById(parentId, q);
    if (!parent) throw validationError('parent_id', 'suite not found');
    if (parent.project_id !== projectId) {
      throw validationError('parent_id', 'must belong to the same project');
    }
    return parent;
  }

  private async loadTree(projectId: string, q?: Queryable): Promise<SuiteTreeNode[]> {
    const rows = await this.store.listByProject(projectId, q);
    const direct = await this.store.liveCaseCountsByProject(projectId, q);
    return buildSuiteTree(rows, rollupCaseCounts(rows, toCountMap(direct)));
  }
}
