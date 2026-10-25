import { SuiteRow } from './suites.store';

/** API projection of a suite — exactly docs/api-suites.md § Resource. */
export interface SuiteDto {
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
}

/** GET /suites/:id adds the root → self breadcrumb trail. */
export interface SuiteDetailDto extends SuiteDto {
  path: SuitePathEntry[];
}

export interface SuitePathEntry {
  id: string;
  name: string;
}

/** Tree node: the Suite shape plus `children` (always present, maybe []). */
export interface SuiteTreeNode extends SuiteDto {
  children: SuiteTreeNode[];
}

export function toSuiteDto(row: SuiteRow, caseCount: number): SuiteDto {
  return {
    id: row.id,
    project_id: row.project_id,
    parent_id: row.parent_id,
    name: row.name,
    description: row.description,
    depth: row.depth,
    position: row.position,
    case_count: caseCount,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
