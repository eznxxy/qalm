import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../errors';
import { AuthGuard, ClientIp, CurrentUser, AuthUser, readRefreshCookie } from './current-user';
import type { UserDto } from '../users/users.service';
import { BootstrapDto, LoginDto, UpdateMeDto } from './dto';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_SECONDS } from './tokens.service';

/**
 * Auth endpoints, docs/api-auth.md. Sessions: the refresh token lives ONLY in
 * an HttpOnly SameSite=Lax cookie scoped to /api/v1/auth; access tokens in the
 * JSON body. Refresh/logout/refresh-failure paths never put token material in
 * response bodies or logs.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('bootstrap')
  async bootstrap(@Body() dto: BootstrapDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.bootstrap(dto);
    this.setRefreshCookie(res, session.refreshToken);
    return this.sessionBody(session.user, session.accessToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @ClientIp() clientIp: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(dto, clientIp);
    this.setRefreshCookie(res, session.refreshToken);
    return this.sessionBody(session.user, session.accessToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(readRefreshCookie(request));
    this.setRefreshCookie(res, result.refreshToken);
    return {
      data: {
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(request));
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.auth.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    });
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { data: await this.auth.me(user.id) };
  }

  @UseGuards(AuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    // Reject no-op bodies: the contract defines name and/or a password change.
    if (dto.name === undefined && dto.new_password === undefined && dto.current_password === undefined) {
      throw new ApiError('VALIDATION_ERROR', 'Provide a name and/or a password change.', [
        { field: 'name', issue: 'must be provided when no password change is requested' },
      ]);
    }
    return { data: await this.auth.updateMe(user.id, dto) };
  }

  private setRefreshCookie(res: Response, raw: string): void {
    res.cookie(REFRESH_COOKIE_NAME, raw, {
      httpOnly: true,
      // cookieSecure inverts REFRESH_COOKIE_SECURE (the documented dev-relax
      // flag): Secure always, except plain-HTTP local development.
      secure: this.auth.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }

  private sessionBody(user: UserDto, accessToken: string) {
    return {
      data: {
        user,
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }
}
