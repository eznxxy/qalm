import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/current-user';
import { AdminUpdateUserDto, CreateUserDto, ListUsersQuery } from './dto';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin user-management endpoints, docs/api-auth.md § Endpoints — user
 * management + § Role matrix: every route is Admin-only; Lead/Tester/Viewer
 * get 403 (AuthGuard + @Roles('admin')). There is deliberately NO DELETE
 * route — users are deactivated, never hard-deleted.
 */
@UseGuards(AuthGuard)
@Roles('admin')
@Controller('users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return { data: await this.users.create(dto) };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.users.findOne(id) };
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateUserDto) {
    return { data: await this.users.update(id, dto) };
  }
}
