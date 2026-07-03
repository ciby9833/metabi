import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { DatasetService } from '../services/dataset.service';
import { ConfirmDatasetDto, UpdateDatasetDto } from '../dto/dataset.dto';

@ApiTags('datasets')
@Controller('datasets')
export class DatasetController {
  constructor(private readonly datasetService: DatasetService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({
    summary: '上传 CSV/Excel — 同步解析返回 schema 预览',
    description: '返回 dataset.id + columns (推断的 schema)。下一步调 /datasets/:id/confirm 入库。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.datasetService.uploadAndParse(file, user.id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '确认 schema 并入库 — 用户编辑列名/类型/描述/项目归属后调',
    description: '异步入库；用 GET /datasets/:id 轮询 status 直到 ready。',
  })
  async confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDatasetDto,
  ) {
    return this.datasetService.confirmAndImport(id, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '列出当前用户可访问的所有 dataset（own + 所在 project）' })
  async list(@CurrentUser() user: AuthUser) {
    return this.datasetService.listAccessible(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '查 dataset 详情（含 status / columns / 错误信息）' })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.datasetService.getAccessible(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '改归属 / 改名 / 改描述（仅 owner）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDatasetDto,
  ) {
    return this.datasetService.updateAssignment(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删 dataset + DROP TABLE（仅 owner）' })
  async delete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.datasetService.delete(id, user.id);
  }
}
