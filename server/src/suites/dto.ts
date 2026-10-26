import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { SUITE_DESCRIPTION_MAX, SUITE_NAME_MAX } from './suites.constants';

/**
 * Request DTOs for the suites endpoints, docs/api-suites.md § Validation.
 * Cross-row rules (siblings, depth, ordering) live in SuitesService; these
 * classes pin field shapes so the global pipe produces the contract envelope.
 */

/**
 * Presence gate for PATCH fields: `@IsOptional()` also skips explicit nulls,
 * which would let a null name reach a NOT NULL column. This runs validators on
 * null while still skipping absent fields.
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

/** Trims at validation time so uniqueness compares what will be stored. */
export function Trimmed(): PropertyDecorator {
  return transformString((value) => value.trim());
}

export class CreateSuiteDto {
  @IsString()
  @Trimmed()
  @Length(1, SUITE_NAME_MAX)
  name!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, SUITE_DESCRIPTION_MAX)
  description?: string | null;

  /** null (or absent) creates a root suite. */
  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  /** Defaults to the end of the sibling group; 1 inserts before the first. */
  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  position?: number;
}

export class UpdateSuiteDto {
  @ValidateIf(isPresent)
  @IsString()
  @Trimmed()
  @Length(1, SUITE_NAME_MAX)
  name?: string | null;

  /** Explicit null clears the description. */
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, SUITE_DESCRIPTION_MAX)
  description?: string | null;

  /** Explicit null moves the suite to the project root. */
  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  position?: number;
}

export class ReorderSuiteItemDto {
  @IsUUID()
  id!: string;

  /** null (or absent) means the project root group. */
  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @transformToNumber()
  @IsInt()
  @Min(1)
  position!: number;
}

/** PATCH /projects/:projectId/suites/order — only the groups that changed. */
export class ReorderSuitesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderSuiteItemDto)
  items!: ReorderSuiteItemDto[];
}
