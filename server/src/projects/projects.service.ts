import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { conflictFor, ProjectRow, ProjectsStore } from './projects.store';
import {
  CreateProjectDto,
  ListProjectsQuery,
  UpdateProjectDto,
} from './dto';
import { AuthUser } from '../auth/current-user';

/** API projection of a project — exactly docs/api-projects.md § Resource. */
export interface ProjectDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/** api-conventions.md § Envelopes, list meta shape. */
export function buildListMeta(total: number, page: number, limit: number): ListMeta {
  return {
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Business rules for the projects endpoints, docs/api-projects.md. Role
 * enforcement (§ Role matrix) lives in the controller via @Roles + AuthGuard;
 * visibility of archived rows for non-Admins is enforced here.
 */
@Injectable()
export class ProjectsService {
  constructor(@Inject(ProjectsStore) private readonly store: ProjectsStore) {}

  async create(caller: AuthUser, dto: CreateProjectDto): Promise<ProjectDto> {
    // Pre-check names the field; the unique indexes (catch path) close the race.
    const existingName = await this.store.findIdByNameIgnoreCase(dto.name);
    if (existingName !== null) {
      throw conflictFor('name');
    }
    const existingKey = await this.store.findIdByKeyIgnoreCase(dto.key);
    if (existingKey !== null) {
      throw conflictFor('key');
    }
    const row = await this.store.insert({
      key: dto.key,
      name: dto.name,
      description: dto.description ?? null,
      created_by: caller.id,
    });
    return toProjectDto(row);
  }

  /**
   * Fetch visible to the caller: archived projects are invisible to non-Admins
   * (Lead included) — contract maps that to 404 NOT_FOUND, not 403.
   */
  async findVisible(id: string, caller: AuthUser): Promise<ProjectDto> {
    const row = await this.store.findById(id);
    if (!row || (row.status === 'archived' && caller.role !== 'admin')) {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
    return toProjectDto(row);
  }

  /**
   * Admin-only (guard). PATCH must not change status: only the three body
   * fields are ever written, and `status` is a non-whitelisted property in
   * UpdateProjectDto (the global pipe rejects it with 400).
   */
  async update(id: string, dto: UpdateProjectDto): Promise<ProjectDto> {
    const fields: { name?: string; key?: string; description?: string } = {};
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.key !== undefined) fields.key = dto.key;
    if (dto.description !== undefined) fields.description = dto.description;

    // Pre-checks name the field, excluding the project itself.
    if (fields.name !== undefined) {
      const existing = await this.store.findIdByNameIgnoreCase(fields.name);
      if (existing !== null && existing !== id) throw conflictFor('name');
    }
    if (fields.key !== undefined) {
      const existing = await this.store.findIdByKeyIgnoreCase(fields.key);
      if (existing !== null && existing !== id) throw conflictFor('key');
    }
    const updated = await this.store.update(id, fields);
    if (!updated) {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
    return toProjectDto(updated);
  }

  /**
   * Archive is idempotent (200 every time) and works on projects in either
   * status; a no-op re-archive still bumps updated_at (honest about the call).
   */
  async archive(id: string): Promise<ProjectDto> {
    const updated = await this.store.archive(id);
    if (!updated) {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
    return toProjectDto(updated);
  }

  /** Restore is idempotent; a restored project re-enters the default list. */
  async restore(id: string): Promise<ProjectDto> {
    const updated = await this.store.restore(id);
    if (!updated) {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
    return toProjectDto(updated);
  }

  /** Listing with substring search, optional status filter, pagination. */
  async list(
    caller: AuthUser,
    q: ListProjectsQuery,
  ): Promise<{ data: ProjectDto[]; meta: ListMeta }> {
    const isAdmin = caller.role === 'admin';
    const requested = q.status ?? null;
    if (requested === 'archived' && !isAdmin) {
      // Contract: archived filter is Admin-only — for any role, not just the
      // write-forbidden ones (§ Role matrix: Lead/Tester/Viewer "active only").
      throw new ApiError('FORBIDDEN', 'Only admins can list archived projects.');
    }
    // Default listing excludes archived for everyone; Admins with an explicit
    // status get exactly that status.
    const visibleStatuses: Array<'active' | 'archived'> = isAdmin
      ? ['active', 'archived']
      : ['active'];
    const statusFilter: 'active' | 'archived' | null = q.status ?? null;
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const total = await this.store.countVisible(q.query ?? null);
    const rows = await this.store.listPage({
      visibleStatuses,
      statusFilter,
      query: q.query ?? null,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      data: rows.map(toProjectDto),
      meta: buildListMeta(total, page, limit),
    };
  }

  private async requireRow(id: string): Promise<ProjectRow> {
    const row = await this.store.findById(id);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
    return row;
  }
}

