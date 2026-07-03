import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatasourceService } from '../services/datasource.service';
import {
  CreateDatasourceDto,
  TestConnectionDto,
  UpdateDatasourceDto,
} from '../dto/datasource.dto';
import { SchemaIndexService } from '../../../providers/schema-index/schema-index.service';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('Datasource')
@Controller('datasource')
export class DatasourceController {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly schemaIndex: SchemaIndexService,
  ) {}

  @Post(':id/reindex')
  @ApiOperation({ summary: '重建数据源的 schema 向量索引（用于 search_tables 工具）' })
  async reindex(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.datasourceService.getById(id, user.id);
    return this.schemaIndex.reindex(id);
  }

  @Get()
  @ApiOperation({ summary: '当前用户的数据源列表' })
  list(@CurrentUser() user: AuthUser) {
    return this.datasourceService.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建数据源（owner = 当前用户）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDatasourceDto) {
    return this.datasourceService.create(dto, user.id);
  }

  @Post('test')
  @ApiOperation({ summary: '测试连接（不保存）' })
  test(@Body() dto: TestConnectionDto) {
    return this.datasourceService.testConnection(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取数据源详情' })
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.datasourceService.getById(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新数据源' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDatasourceDto) {
    return this.datasourceService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除数据源' })
  async delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.datasourceService.delete(id, user.id);
  }

  @Get(':id/tables')
  @ApiOperation({ summary: '获取表列表' })
  tables(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('schema') schema?: string,
  ) {
    return this.datasourceService.listTables(id, user.id, schema);
  }

  // ⚠️ 路由顺序：tables-columns 必须在 tables/:table 之前
  // 否则 nest 会把 "tables-columns" 当成 :table 参数
  @Get(':id/tables-columns')
  @ApiOperation({ summary: '批量拉多张表的字段（@ 联想用）' })
  describeMany(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tables') tables: string,
    @Query('schema') schema?: string,
  ) {
    const list = (tables || '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.datasourceService.describeMany(id, list, user.id, schema);
  }

  @Get(':id/tables/:table')
  @ApiOperation({ summary: '获取表结构' })
  describeTable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('table') table: string,
    @Query('schema') schema?: string,
  ) {
    return this.datasourceService.describeTable(id, table, user.id, schema);
  }
}
