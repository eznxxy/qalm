import { IsEmail, IsOptional, IsString, Length, Matches, registerDecorator } from 'class-validator';
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from './password.service';

/**
 * class-validator decorator enforcing docs/api-conventions.md password policy:
 * >= 8 chars, at least one letter and one digit.
 */
export function IsPolicyPassword(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPolicyPassword',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return passwordMeetsPolicy(value as string);
        },
        defaultMessage(): string {
          return PASSWORD_POLICY_MESSAGE;
        },
      },
    });
  };
}

export class BootstrapDto {
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'must not be blank' })
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsPolicyPassword()
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 1000)
  password!: string;
}

/**
 * PATCH /auth/me body: name alone, or a password change requiring BOTH
 * current_password and new_password (cross-field rule enforced in the
 * service, class-validator handles field-level rules).
 */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'must not be blank' })
  name?: string;

  @IsOptional()
  @IsString()
  current_password?: string;

  @IsOptional()
  @IsString()
  @IsPolicyPassword()
  new_password?: string;
}
