import { Controller, Get } from '@nestjs/common';

/**
 * Public infrastructure endpoint (documented exception to the auth rules,
 * api-conventions.md): GET /api/v1/health -> 200 {"data":{"status":"ok"}}.
 * Not a feature contract; feature modules live elsewhere.
 */
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { data: { status: string } } {
    return { data: { status: 'ok' } };
  }
}
