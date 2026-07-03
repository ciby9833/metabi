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
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { TaskService } from '../services/task.service';
import { CreateTaskDto, UpdateTaskDto } from '../dto/task.dto';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('Task')
@Controller('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  @ApiOperation({ summary: '当前用户的任务列表' })
  list(@CurrentUser() user: AuthUser) {
    return this.taskService.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建定时任务' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.taskService.create(dto, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取任务详情' })
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskService.getById(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新任务' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.taskService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除任务' })
  async delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.taskService.delete(id, user.id);
  }

  @Post(':id/execute')
  @ApiOperation({ summary: '手动触发执行任务' })
  execute(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskService.execute(id, user.id);
  }
}
