import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
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
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsDateOnly, Trimmed } from '../runs/dto';
import { MAX_LIMIT } from '../runs/runs.constants';
import {
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_NAME_MAX,
  MILESTONE_RUNS_MAX,
  MILESTONE_SORT_PATTERN,
} from './milestones.constants';

/**
 * Request DTOs for the milestones endpoints, docs/api-milestones.md
 * § Validation. Cross-row rules (duplicate name, archived project, run
 * eligibility) live in MilestonesService; these classes pin field shapes so the
 * global pipe produces the contract envelope.
 */

/**
 * Presence gate for PATCH fields: `@IsOptional()` also skips explicit nulls,
 * which would let a null reach a NOT NULL column. This runs validators on null
 * while still skipping absent fields.
 */
function isPresent(_object: unknown, value: unknown): boolean {
  return value !== undefined;
}

function transformToNumber(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return typeof value === 'string' ? Number(value) : value;
  });
}

/** `due_date` / `created_at` / `updated_at` / `name`, optional `-` for desc. */
export function IsMilestoneSort(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isMilestoneSort',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && MILESTONE_SORT_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'must be one of: due_date, created_at, updated_at, name (prefix - for descending)';
        },
      },
    });
  };
}

/** POST /projects/:projectId/milestones — fields only; runs attach later. */
export class CreateMilestoneDto {
  @IsString()
  @Trimmed()
  @Length(1, MILESTONE_NAME_MAX)
  name!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, MILESTONE_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;
}

/** PATCH /milestones/:id — any non-empty subset; `null` clears optional fields. */
export class UpdateMilestoneDto {
  @ValidateIf(isPresent)
  @IsString()
  @Trimmed()
  @Length(1, MILESTONE_NAME_MAX)
  name?: string;

  /** Explicit null clears the description. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, MILESTONE_DESCRIPTION_MAX)
  description?: string | null;

  /** Explicit null clears the due date; runs keep their own dates. */
  @IsOptional()
  @IsDateOnly()
  due_date?: string | null;
}

/** GET /projects/:projectId/milestones (docs/api-milestones.md § Endpoints). */
export class ListMilestonesQuery {
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(1, 200)
  query?: string;

  /** Derived status; a milestone with no runs is always `open`. */
  @IsOptional()
  @IsIn(['open', 'completed'])
  status?: 'open' | 'completed';

  @IsOptional()
  @IsString()
  @IsMilestoneSort()
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

/** POST /milestones/:id/runs — attach runs that have no milestone yet. */
export class AttachMilestoneRunsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MILESTONE_RUNS_MAX)
  @IsUUID('all', { each: true })
  run_ids!: string[];
}