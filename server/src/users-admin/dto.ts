import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  ValidationArguments,
} from 'class-validator';
import { IsPolicyPassword, UserRole } from '../auth/helpers';

function transformToNumber(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return typeof value === 'string' ? Number(value) : value;
  });
}

function trimString(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return typeof value === 'string' ? value.trim() : value;
  });
}

const USER_ROLES: readonly UserRole[] = ['admin', 'lead', 'tester', 'viewer'];

/**
 * Contract-literal role whitelist (docs/api-auth.md § User): lowercase enum
 * members only — filtering is not key input, `Admin`/`TESTER` are invalid.
 */
export function IsInUserRole(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isInUserRole',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            (USER_ROLES as readonly string[]).includes(value)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          const value: unknown = args.value;
          const got = typeof value === 'string' ? ` (got "${value}")` : '';
          return 'must be one of: admin, lead, tester, viewer' + got;
        },
      },
    });
  };
}

/**
 * GET /users query, docs/api-auth.md § Endpoints — user management (Admin):
 * `query` substring on email or name, optional `role` filter, page/limit per
 * api-conventions.md § Pagination (limit default 25, max 100).
 */
export class ListUsersQuery {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  query?: string;

  @IsOptional()
  @IsInUserRole()
  role?: UserRole;

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
 * POST /users body, docs/api-auth.md. The initial password follows the shared
 * policy (>= 8 chars, letter + digit); the created user always gets
 * must_change_password=true (service, not input).
 */
export class CreateUserDto {
  @IsEmail()
  @trimString()
  email!: string;

  @IsString()
  @trimString()
  @Length(1, 200)
  name!: string;

  @IsInUserRole()
  role!: UserRole;

  @IsString()
  @IsPolicyPassword()
  password!: string;
}

/**
 * Presence gate for PATCH fields. `@IsOptional()` skips validation on null as
 * well as undefined, which would let explicit nulls through to NOT NULL
 * columns (the store would 500). This gate skips only absent (undefined)
 * fields; a present null runs the validators below and fails with a 400
 * naming the field. Ported from the projects PATCH fix (commit 15a23ae).
 */
function isPresent(_object: unknown, value: unknown): boolean {
  return value !== undefined;
}

/**
 * PATCH /users/:id body — any subset of name/role/is_active/password
 * (docs/api-auth.md). `password` is the Admin reset: never returned, sets
 * must_change_password=true on the target. Last-admin rule is a service-level
 * cross-field rule (409), same split as auth's UpdateMeDto.
 *
 * `{}` is a 200 no-op at the service level (returns the current row, revokes
 * nothing); explicit null for any field is a 400 VALIDATION_ERROR naming the
 * field (the @ValidateIf gate below + a service guard behind it).
 */
export class AdminUpdateUserDto {
  @ValidateIf(isPresent)
  @IsString()
  @trimString()
  @Length(1, 200)
  name?: string | null;

  @ValidateIf(isPresent)
  @IsInUserRole()
  role?: UserRole | null;

  @ValidateIf(isPresent)
  @IsBoolean()
  is_active?: boolean | null;

  @ValidateIf(isPresent)
  @IsString()
  @IsPolicyPassword()
  password?: string | null;
}
