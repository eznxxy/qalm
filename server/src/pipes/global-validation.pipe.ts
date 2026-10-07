import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { validate, ValidationError } from 'class-validator';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { ValidationErrorDetail } from '../errors';
/**
 * Global validation pipe producing the contract envelope on failure:
 * 400 { error: { code: "VALIDATION_ERROR", message, details: [{field, issue}] } }.
 * Unknown properties are rejected (whitelist) and missing typings are forbidden,
 * so payloads are shaped exactly as the contracts describe.
 */
@Injectable()
export class GlobalValidationPipe implements PipeTransform {
  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (value === null || value === undefined) {
      return value;
    }
    const type = metadata.metatype;
    if (!type || this.isPrimitiveType(type)) {
      return value;
    }

    // metatype is a runtime DTO class; pin the class-transformer generic so the
    // instance is typed as a real object for validation.
    const instance: object = plainToInstance(type as ClassConstructor<object>, value, {
      enableImplicitConversion: false,
      exposeUnsetFields: false,
    });

    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length === 0) {
      return instance;
    }

    const details: ValidationErrorDetail[] = [];
    for (const error of errors) {
      this.collectDetails(error, error.property, details);
    }
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details,
    });
  }

  private collectDetails(
    error: ValidationError,
    fieldPath: string,
    details: ValidationErrorDetail[],
  ): void {
    const constraints = error.constraints;
    if (constraints) {
      for (const issue of Object.values(constraints)) {
        details.push({ field: fieldPath, issue });
      }
    }
    for (const child of error.children ?? []) {
      this.collectDetails(child, `${fieldPath}.${child.property}`, details);
    }
  }

  private isPrimitiveType(type: abstract new (...args: never[]) => unknown): boolean {
    return [String, Boolean, Number, Array, Object].some(
      (primitive) => primitive === type,
    );
  }
}
