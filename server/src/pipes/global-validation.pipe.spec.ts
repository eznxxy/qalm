import { ArgumentMetadata } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ValidationErrorDetail } from '../errors';
import { GlobalValidationPipe } from './global-validation.pipe';

class SampleDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @MaxLength(10)
  note!: string;
}

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: SampleDto,
  data: '',
};

/** Runs the pipe, expecting (and returning) the rejection reason. */
async function failureOf(promise: Promise<unknown>): Promise<{ response?: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as { response?: unknown };
  }
  throw new Error('expected the pipe to reject this input');
}

describe('GlobalValidationPipe', () => {
  const pipe = new GlobalValidationPipe();

  it('passes a valid body through (as a typed instance)', async () => {
    const result = await pipe.transform({ email: 'a@b.co', name: 'Ada', note: 'hi' }, metadata);
    expect(result).toBeInstanceOf(SampleDto);
    expect(result).toEqual({ email: 'a@b.co', name: 'Ada', note: 'hi' });
  });

  it('rejects invalid bodies with the contract envelope and details', async () => {
    const failure = await failureOf(
      pipe.transform({ email: 'not-an-email', name: '', note: 'x' }, metadata),
    );
    const response = failure.response as {
      code: string;
      message: string;
      details: ValidationErrorDetail[];
    };
    expect(response.code).toBe('VALIDATION_ERROR');
    expect(response.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'name' }),
      ]),
    );
    for (const detail of response.details) {
      expect(Object.keys(detail).sort()).toEqual(['field', 'issue']);
    }
  });

  it('rejects unknown (non-whitelisted) properties', async () => {
    const failure = await failureOf(
      pipe.transform({ email: 'a@b.co', name: 'Ada', note: 'hi', is_admin: true }, metadata),
    );
    const response = failure.response as { code: string; details: ValidationErrorDetail[] };
    expect(response.code).toBe('VALIDATION_ERROR');
    expect(response.details.some((d) => d.field === 'is_admin')).toBe(true);
  });

  it('leaves primitive metatypes untouched', async () => {
    const result = await pipe.transform('x', {
      type: 'query',
      metatype: String,
      data: '',
    });
    expect(result).toBe('x');
  });

  it('passes through null/undefined bodies', async () => {
    expect(await pipe.transform(undefined, metadata)).toBeUndefined();
    expect(await pipe.transform(null, metadata)).toBeNull();
  });
});
