import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

/** Contract regex, docs/api-projects.md § Validation (letter first). */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/;

/** Normalizes the project key: trims, then uppercases case-insensitive input. */
export function normalizeProjectKey(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Typed wrapper so class-transformer's `any`-typed params never leak into the
 * file's types (strict any lint applies to src/).
 */
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

/**
 * Trims at validation time (contract: "trimmed 1-100 chars") so service and
 * store compare exactly what will be stored.
 */
export function Trimmed(): PropertyDecorator {
  return transformString((value) => value.trim());
}

/**
 * class-validator decorator enforcing the project-key shape AFTER the
 * uppercase transform has run. Never applies normalization here: a second
 * transform pass would re-upperize the PATCH error path and hide bad input
 * from the client.
 */
export function IsProjectKey(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isProjectKey',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            value.length >= 2 &&
            value.length <= 10 &&
            PROJECT_KEY_PATTERN.test(value)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          const value: unknown = args.value;
          const shape =
            typeof value === 'string' && /^[a-z]+$/i.test(value)
              ? ` (got "${value}")`
              : '';
          return (
            'must be 2-10 characters, uppercase letter first, then A-Z or 0-9' +
            shape
          );
        },
      },
    });
  };
}

export class CreateProjectDto {
  @IsString()
  @Trimmed()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Trimmed()
  @transformString(normalizeProjectKey)
  @IsProjectKey()
  key!: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, 500)
  description?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @transformString(normalizeProjectKey)
  @IsProjectKey()
  key?: string;

  @IsOptional()
  @IsString()
  @Trimmed()
  @Length(0, 500)
  description?: string;
}

/** GET /projects query — page/limit per api-conventions.md § Pagination. */
export class ListProjectsQuery {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  query?: string;

  @IsOptional()
  @IsInProjectStatus()
  status?: 'active' | 'archived';

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Contract-literal status whitelist: active or archived, lowercase only.
 * `ACTIVE`/`Archived` are invalid queries — filtering is not key input.
 */
export function IsInProjectStatus(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isInProjectStatus',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return value === 'active' || value === 'archived';
        },
        defaultMessage(): string {
          return 'must be one of: active, archived';
        },
      },
    });
  };
}
