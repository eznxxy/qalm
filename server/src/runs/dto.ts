import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ADD_CASES_MAX,
  DATE_PATTERN,
  ITEM_SORT_PATTERN,
  ITEM_STATUSES,
  MAX_LIMIT,
  RESULT_COMMENT_MAX,
  RESULT_DEFECT_URL_MAX,
  RESULT_ELAPSED_MAX,
  RESULT_STATUSES,
  RUN_DESCRIPTION_MAX,
  RUN_NAME_MAX,
  RUN_SORT_PATTERN,
  ItemStatus,
  ResultStatus,
} from './runs.constants';

/**
 * Request DTOs for the runs endpoints, docs/api-runs.md § Validation.
 * Cross-row rules (selection materialisation, capacity, Tester write guard)
 * live in RunsService; these classes pin field shapes so the global pipe
 * produces the contract envelope.
 */

/**
 * Presence gate for PATCH fields: `@IsOptional()` also skips explicit nulls,
 * which would let a null reach a NOT NULL column. This runs validators on null
 * while still skipping absent fields.
 */
function isPresent(_object: unknown, value: unknown): boolean {
  return value !== undefined;
}

function transformString(fn: (value: string) => string): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return typeof value === 'string' ? fn(value) : value;
  });
}

function transformToNumber(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return typeof value === 'string' ? Number(value) : value;
  });
}

/** Trims at validation time so the stored value is exactly what was validated. */
export function Trimmed(): PropertyDecorator {
  return transformString((value) => value.trim());
}

/** Repeatable query params: one value → [value]; arrays pass through. */
export function ToArray(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return Array.isArray(value) ? value : [value];
  });
}

/** `include_descendants` arrives as a query string; booleans pass through (tests). */
export function ToBoolean(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
}

/**
 * A filter value that is either a UUID or the literal `none` (unassigned /
 * no plan) — docs/api-runs.md § GET .../runs (`plan_id=none`) and
 * § GET .../items (`assignee_id=none`).
 */
export function IsUuidOrNone(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isUuidOrNone',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          if (value === 'none') return true;
          return (
            typeof value === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
          );
        },
        defaultMessage(): string {
          return 'must be a UUID or "none"';
        },
      },
    });
  };
}

/** `created_at` / `updated_at` / `due_date` / `name`, optional `-` for desc. */
export function IsRunSort(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isRunSort',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && RUN_SORT_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'must be one of: created_at, updated_at, due_date, name (prefix - for descending)';
        },
      },
    });
  };
}

/** `position` / `case_display_id` / `status` / `updated_at`, optional `-`. */
export function IsItemSort(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isItemSort',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && ITEM_SORT_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'must be one of: position, case_display_id, status, updated_at (prefix - for descending)';
        },
      },
    });
  };
}

/** `YYYY-MM-DD` or null (null clears the stored date). */
export function IsDateOnly(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && DATE_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'must be a date in YYYY-MM-DD format';
        },
      },
    });
  };
}

/**
 * A defect link: an `http(s)` URL of at most `RESULT_DEFECT_URL_MAX` chars.
 * Deliberately narrower than class-validator's `@IsUrl()` (which also accepts
 * other schemes and has no length bound).
 */
export function IsHttpUrl(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isHttpUrl',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length > RESULT_DEFECT_URL_MAX) return false;
          try {
            const url = new URL(value);
            return url.protocol === 'http:' || url.protocol === 'https:';
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `must be an http(s) URL of at most ${RESULT_DEFECT_URL_MAX} characters`;
        },
      },
    });
  };
}

/** Create-only case selection: explicit ids and/or a suite subtree. */
export class RunSelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  case_ids?: string[];

  @IsOptional()
  @IsUUID()
  suite_id?: string;

  /** Defaults to true: the selected suite plus its descendants. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  include_descendants?: boolean;
}

export class CreateRunDto {
  @IsString()
  @Trimmed()
  @Length(1, RUN_NAME_MAX)
  name!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, RUN_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  plan_id?: string | null;

  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;

  /** Omit for an empty run; items can be added later. */
  @IsOptional()
  @ValidateNested()
  @Type(() => RunSelectionDto)
  selection?: RunSelectionDto;
}

export class UpdateRunDto {
  @ValidateIf(isPresent)
  @IsString()
  @Trimmed()
  @Length(1, RUN_NAME_MAX)
  name?: string;

  /** Explicit null clears the description. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, RUN_DESCRIPTION_MAX)
  description?: string | null;

  /** Explicit null detaches the run from its plan. */
  @IsOptional()
  @IsUUID()
  plan_id?: string | null;

  /** Explicit null clears the due date. */
  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;
}

/** GET /projects/:projectId/runs (docs/api-runs.md § Endpoints). */
export class ListRunsQuery {
  /** UUID restricts to one plan; `none` selects runs with no plan. */
  @IsOptional()
  @IsUuidOrNone()
  plan_id?: string;

  @IsOptional()
  @IsIn(['open', 'completed'])
  status?: 'open' | 'completed';

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(1, 200)
  query?: string;

  @IsOptional()
  @IsString()
  @IsRunSort()
  sort?: string;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

/** GET /runs/:id/items. */
export class ListRunItemsQuery {
  /** OR within; a repeatable `untested` matches items with no results. */
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn([...ITEM_STATUSES], { each: true })
  status?: ItemStatus[];

  /** UUID restricts to one assignee; `none` matches unassigned items. */
  @IsOptional()
  @IsUuidOrNone()
  assignee_id?: string;

  @IsOptional()
  @IsUUID()
  suite_id?: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(1, 200)
  query?: string;

  @IsOptional()
  @IsString()
  @IsItemSort()
  sort?: string;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

/** POST /runs/:id/items — add cases to an existing run. */
export class AddRunItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(ADD_CASES_MAX)
  @IsUUID('all', { each: true })
  case_ids!: string[];
}

/** PATCH /runs/:id/items/:itemId — assign or reorder. */
export class UpdateRunItemDto {
  /** Explicit null clears the assignee. */
  @IsOptional()
  @IsUUID()
  assignee_id?: string | null;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  position?: number;
}

/** POST /runs/:id/assign — bulk assign; omit item_ids to target every item. */
export class AssignRunItemsDto {
  /** Explicit null unassigns. */
  @IsOptional()
  @IsUUID()
  assignee_id!: string | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  item_ids?: string[];
}

/**
 * POST /runs/:id/items/:itemId/results — record a result. `failed` requires a
 * comment, but that cross-field rule lives in ResultsService so the 400 can name
 * the `comment` field (the DB check is the same invariant).
 */
export class CreateResultDto {
  @IsIn([...RESULT_STATUSES])
  status!: ResultStatus;

  /** Optional ≤ 4,000 chars; required when `status = failed`. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, RESULT_COMMENT_MAX)
  comment?: string | null;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(0)
  @Max(RESULT_ELAPSED_MAX)
  elapsed_minutes?: number | null;

  @IsOptional()
  @IsString()
  @IsHttpUrl()
  defect_url?: string | null;
}

/**
 * PATCH /results/:id — edit the latest result. `status` is not declared, so the
 * global pipe's whitelist rejects it (PRD decision 4: status is immutable).
 */
export class UpdateResultDto {
  /** `null` (or blank) clears the comment — rejected if the result is `failed`. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, RESULT_COMMENT_MAX)
  comment?: string | null;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(0)
  @Max(RESULT_ELAPSED_MAX)
  elapsed_minutes?: number | null;

  /** `null` clears the link. */
  @IsOptional()
  @IsString()
  @IsHttpUrl()
  defect_url?: string | null;
}

/** GET /runs/:id/items/:itemId/results — the item's result history. */
export class ListResultsQuery {
  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

/**
 * GET /cases/:id/runs — the case drawer's Linked runs feed (docs/api-runs.md
 * § Linked runs). The order is fixed (newest run first), so there is no `sort`.
 */
export class ListCaseRunsQuery {
  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}