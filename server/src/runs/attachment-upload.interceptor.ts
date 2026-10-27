import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { ApiError } from '../errors';
import { ATTACHMENT_MAX_BYTES } from './runs.constants';

/**
 * `multipart/form-data` upload of one attachment, field name `file`
 * (docs/api-runs.md § POST /results/:id/attachments). Multer parses the part
 * into memory, so the service sees `file.buffer`.
 *
 * The contract wants a file over 10 MB to be `400 VALIDATION_ERROR` naming
 * `file`, but multer raises a 413 `PayloadTooLargeException` (which the global
 * filter would map to `INTERNAL`). This wrapper composes Nest's
 * `FileInterceptor` and rewrites exactly that one exception.
 */
@Injectable()
export class AttachmentUploadInterceptor implements NestInterceptor {
  private readonly upload: NestInterceptor;

  constructor() {
    // Composition rather than `extends`: FileInterceptor() returns a mixin
    // whose constructor injects MULTER_MODULE_OPTIONS. Constructing it with no
    // argument lets that injection fall back to `{}` while `localOptions` still
    // applies. Extending would pull the mixin's decorator metadata into this
    // class for no benefit.
    this.upload = new (FileInterceptor('file', {
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
    }))();
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await this.upload.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
          { field: 'file', issue: `must be at most ${ATTACHMENT_MAX_BYTES} bytes` },
        ]);
      }
      throw error;
    }
  }
}