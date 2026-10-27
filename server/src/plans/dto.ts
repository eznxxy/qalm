import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  DATE_PATTERN,
  MAX_LIMIT,
  RUN_DESCRIPTION_MAX,
  RUN_NAME_MAX,
} from '../runs/runs.constants';
import {
  PLAN_DESCRIPTION_MAX,
  PLAN_NAME_MAX,
  PLAN_RUNS_MAX,
  PLAN_SORT_PATTERN,
} from './plans.constants';

/**
 * Request DTOs for the plans endpoints, docs/api-plans.md § Validation.
 * Cross-row rules (duplicate name, archived project, non-empty patch) live in
 * PlansService; these classes pin field shapes so the global pipe produces the
 * contract envelope.
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
function Trimmed(): PropertyDecorator {
  return transformString((value) => value.trim());
}

/** `YYYY-MM-DD` or null (null clears the stored date). */
function IsDateOnly(): PropertyDecorator {
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

/** `created_at` / `updated_at` / `name` / `due_date`, optional `-` for desc. */
function IsPlanSort(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPlanSort',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && PLAN_SORT_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'must be one of: created_at, updated_at, name, due_date (prefix - for descending)';
        },
      },
    });
  };
}

/**
 * One run created inside a plan create (docs/api-plans.md § POST). The run
 * fields mirror the run's own create DTO, minus `plan_id` (it is the new plan)
 * and minus `selection` (an embedded run starts empty).
 */
export class CreatePlanRunDto {
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
  @IsDateOnly()
  start_date?: string | null;

  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;
}

export class CreatePlanDto {
  @IsString()
  @Trimmed()
  @Length(1, PLAN_NAME_MAX)
  name!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, PLAN_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;

  /**
   * Required: a plan is a collection of runs, so a plan is born with 1–20 of
   * them. Validation names the item, e.g. `runs[1].name`.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(PLAN_RUNS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreatePlanRunDto)
  runs!: CreatePlanRunDto[];
}

export class UpdatePlanDto {
  @ValidateIf(isPresent)
  @IsString()
  @Trimmed()
  @Length(1, PLAN_NAME_MAX)
  name?: string;

  /** Explicit null clears the description. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, PLAN_DESCRIPTION_MAX)
  description?: string | null;

  /** Explicit null clears the due date. */
  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;
}

/** GET /projects/:projectId/plans (docs/api-plans.md § Endpoints). */
export class ListPlansQuery {
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(1, 200)
  query?: string;

  @IsOptional()
  @IsString()
  @IsPlanSort()
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