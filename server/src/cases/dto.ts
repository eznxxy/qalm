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
  BULK_MOVE_MAX,
  CASE_ESTIMATE_MAX,
  CASE_PRECONDITIONS_MAX,
  CASE_PRIORITIES,
  CASE_SORT_PATTERN,
  CASE_STEPS_MAX,
  CASE_STEP_EXPECTED_MAX,
  CASE_STEP_TEXT_MAX,
  CASE_TAGS_MAX,
  CASE_TAG_MAX,
  CASE_TITLE_MAX,
  CASE_TYPES,
  CasePriority,
  CaseType,
  MAX_LIMIT,
} from './cases.constants';

/**
 * Request DTOs for the cases endpoints, docs/api-cases.md § Validation.
 * Cross-row rules (numbering, history, suite membership) live in CasesService;
 * these classes pin field shapes so the global pipe produces the contract
 * envelope — including the bracketed step index, `steps[1].text`.
 */

/**
 * Presence gate: `@IsOptional()` also skips explicit nulls, which would let a
 * null reach a NOT NULL column. This gate skips only absent fields; a present
 * null runs the validators below and fails with a 400 naming the field.
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

/** Trims at validation time so the service stores exactly what it validated. */
export function Trimmed(): PropertyDecorator {
  return transformString((value) => value.trim());
}

/**
 * Body tags: each string is trimmed and lowercased. Non-arrays are left
 * untouched so `@IsArray` rejects them (a bare string is not a tag list).
 */
export function NormalizedTags(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    if (!Array.isArray(value)) return value;
    return value.map((tag: unknown) => (typeof tag === 'string' ? tag.trim().toLowerCase() : tag));
  });
}

/**
 * Query tags: repeatable params arrive as `string` for one value and
 * `string[]` for several, so one value is wrapped before normalising.
 */
export function NormalizedTagFilter(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    const list = Array.isArray(value) ? value : [value];
    return list.map((tag: unknown) => (typeof tag === 'string' ? tag.trim().toLowerCase() : tag));
  });
}

/** Repeatable query params: one value → [value]; arrays pass through. */
export function ToArray(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return Array.isArray(value) ? value : [value];
  });
}

/** `include_descendants` is a query string; booleans pass through (tests). */
export function ToBoolean(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
}

/** `case_number` / `updated_at` / `title`, optional `-` prefix for desc. */
export function IsCaseSort(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCaseSort',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && CASE_SORT_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'must be one of: case_number, updated_at, title (prefix - for descending)';
        },
      },
    });
  };
}

/** One step in a create/replace payload; `position` is derived from order. */
export class CaseStepInputDto {
  @IsOptional()
  @IsInt()
  position?: number;

  @IsString()
  @Trimmed()
  @Length(1, CASE_STEP_TEXT_MAX)
  text!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, CASE_STEP_EXPECTED_MAX)
  expected_result?: string | null;
}

export class CreateCaseDto {
  @IsUUID()
  suite_id!: string;

  @IsString()
  @Trimmed()
  @Length(1, CASE_TITLE_MAX)
  title!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, CASE_PRECONDITIONS_MAX)
  preconditions?: string | null;

  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(CASE_STEPS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CaseStepInputDto)
  steps?: CaseStepInputDto[];

  @IsIn([...CASE_PRIORITIES])
  priority!: CasePriority;

  @IsIn([...CASE_TYPES])
  type!: CaseType;

  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(CASE_TAGS_MAX)
  @NormalizedTags()
  @IsString({ each: true })
  @Length(1, CASE_TAG_MAX, { each: true })
  tags?: string[];

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(0)
  @Max(CASE_ESTIMATE_MAX)
  estimate_minutes?: number | null;
}

export class UpdateCaseDto {
  /** Single-case move; explicit null is a 400 (a case always has a suite). */
  @ValidateIf(isPresent)
  @IsUUID()
  suite_id?: string;

  @ValidateIf(isPresent)
  @IsString()
  @Trimmed()
  @Length(1, CASE_TITLE_MAX)
  title?: string;

  /** Explicit null clears the preconditions. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, CASE_PRECONDITIONS_MAX)
  preconditions?: string | null;

  /** Replaces the stored step list wholesale; positions follow array order. */
  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(CASE_STEPS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CaseStepInputDto)
  steps?: CaseStepInputDto[];

  @ValidateIf(isPresent)
  @IsIn([...CASE_PRIORITIES])
  priority?: CasePriority;

  @ValidateIf(isPresent)
  @IsIn([...CASE_TYPES])
  type?: CaseType;

  /** `[]` clears the tags; duplicates are removed after lowercasing. */
  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(CASE_TAGS_MAX)
  @NormalizedTags()
  @IsString({ each: true })
  @Length(1, CASE_TAG_MAX, { each: true })
  tags?: string[];

  /** Explicit null clears the estimate. */
  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(0)
  @Max(CASE_ESTIMATE_MAX)
  estimate_minutes?: number | null;
}

export class BulkMoveCasesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_MOVE_MAX)
  @IsUUID('all', { each: true })
  case_ids!: string[];

  @IsUUID()
  suite_id!: string;
}

/** GET /projects/:projectId/cases (docs/api-cases.md § Endpoints). */
export class ListCasesQuery {
  @IsOptional()
  @IsUUID()
  suite_id?: string;

  /** Defaults to true: the selected suite plus its descendants. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  include_descendants?: boolean;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(1, 200)
  query?: string;

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn([...CASE_PRIORITIES], { each: true })
  priority?: CasePriority[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn([...CASE_TYPES], { each: true })
  type?: CaseType[];

  /** AND across values: the case must carry every requested tag. */
  @IsOptional()
  @NormalizedTagFilter()
  @IsArray()
  @IsString({ each: true })
  @Length(1, CASE_TAG_MAX, { each: true })
  tag?: string[];

  @IsOptional()
  @IsString()
  @IsCaseSort()
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

/** GET /cases/:id/history — pagination only. */
export class ListCaseHistoryQuery {
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
