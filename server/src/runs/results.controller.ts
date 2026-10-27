import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../auth/current-user';
import { AttachmentUploadInterceptor } from './attachment-upload.interceptor';
import { CreateResultDto, ListResultsQuery, UpdateResultDto } from './dto';
import { ResultsService, UploadedFile as UploadedFilePart } from './results.service';

/**
 * Result history & recording, docs/api-runs.md § Endpoints + § Role matrix:
 *   POST /runs/:id/items/:itemId/results  admin, lead, assigned tester · 201
 *   GET  /runs/:id/items/:itemId/results  any authenticated role
 */
@UseGuards(AuthGuard)
@Controller('runs/:id/items/:itemId/results')
export class RunItemResultsController {
  constructor(private readonly results: ResultsService) {}

  @Roles('admin', 'lead', 'tester')
  @Post()
  async create(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CreateResultDto,
  ) {
    return { data: await this.results.createResult(caller, id, itemId, dto) };
  }

  @Get()
  async list(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: ListResultsQuery,
  ) {
    return this.results.listResults(caller, id, itemId, query);
  }
}

/**
 * Result attachments are added/edited here rather than on the item, because the
 * contract addresses a result by its own id:
 *   PATCH /results/:id              the author, or admin/lead
 *   POST  /results/:id/attachments  the author, or admin/lead · 201
 */
@UseGuards(AuthGuard)
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Roles('admin', 'lead', 'tester')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResultDto,
  ) {
    return { data: await this.results.updateResult(caller, id, dto) };
  }

  @Roles('admin', 'lead', 'tester')
  @UseInterceptors(AttachmentUploadInterceptor)
  @Post(':id/attachments')
  async upload(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFilePart | undefined,
  ) {
    return { data: await this.results.uploadAttachment(caller, id, file) };
  }
}

/**
 * Attachment bytes, always behind the guard (contract: "never served without a
 * token"):
 *   GET    /attachments/:id  any authenticated role
 *   DELETE /attachments/:id  the author, or admin/lead · 204
 */
@UseGuards(AuthGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly results: ResultsService) {}

  @Get(':id')
  async download(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.results.getAttachment(caller, id);
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      disposition: contentDisposition(file.filename),
      length: file.bytes.length,
    });
  }

  @Roles('admin', 'lead', 'tester')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.results.deleteAttachment(caller, id);
  }
}

/**
 * `inline; filename="…"` with the quote/backslash/CR/LF characters stripped so a
 * crafted filename cannot break out of the header value.
 */
function contentDisposition(filename: string): string {
  const safe = filename.replace(/["\\\r\n]/g, '_');
  return `inline; filename="${safe}"`;
}