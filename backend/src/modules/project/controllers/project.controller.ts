import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProjectService } from '../services/project.service';
import {
  CreateProjectDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateProjectDto,
} from '../dto/project.dto';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('Projects')
@Controller('projects')
export class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get()
  @ApiOperation({ summary: '我参与的所有 Project（owner + member）' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.listForUser(user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建 Project（创建者自动是 owner）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.service.create(dto, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取 Project 详情' })
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新 Project（需 admin/owner）' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除 Project（仅 owner）' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.remove(id, user.id);
  }

  // ============== 成员 ==============

  @Get(':id/members')
  @ApiOperation({ summary: '成员列表' })
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.listMembers(id, user.id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: '邀请成员（按 email；用户必须已注册）' })
  invite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InviteMemberDto) {
    return this.service.invite(id, dto, user.id);
  }

  @Patch(':id/members/:memberId')
  @ApiOperation({ summary: '改成员角色' })
  updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.service.updateMemberRole(id, memberId, dto.role, user.id);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  @ApiOperation({ summary: '移除成员' })
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    await this.service.removeMember(id, memberId, user.id);
  }

  @Post(':id/leave')
  @HttpCode(204)
  @ApiOperation({ summary: '主动退出 Project（owner 不能退）' })
  async leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.leave(id, user.id);
  }
}
