import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatasourceMetadataService } from '../services/metadata.service';
import {
  BatchUpsertColumnMetadataDto,
  GlossaryDto,
  SuggestedQuestionDto,
  UpsertTableMetadataDto,
} from '../dto/metadata.dto';

@ApiBearerAuth()
@ApiTags('Datasource Metadata')
@Controller('datasource/:datasourceId')
export class MetadataController {
  constructor(private readonly meta: DatasourceMetadataService) {}

  // -------- 表 / 列元数据 --------

  @Get('metadata')
  @ApiOperation({ summary: '获取数据源全部元数据' })
  listAll(@Param('datasourceId') datasourceId: string) {
    return this.meta.getAllForDatasource(datasourceId);
  }

  @Get('metadata/tables/:tableName')
  @ApiOperation({ summary: '获取某张表的表级+列级元数据' })
  getTable(
    @Param('datasourceId') datasourceId: string,
    @Param('tableName') tableName: string,
  ) {
    return this.meta.getForTable(datasourceId, tableName);
  }

  @Put('metadata/tables/:tableName')
  @ApiOperation({ summary: '更新表级元数据（描述/时区/同义词）' })
  upsertTable(
    @Param('datasourceId') datasourceId: string,
    @Param('tableName') tableName: string,
    @Body() dto: UpsertTableMetadataDto,
  ) {
    return this.meta.upsertTableMeta(datasourceId, tableName, dto);
  }

  @Put('metadata/tables/:tableName/columns')
  @ApiOperation({ summary: '批量保存某表的多列元数据' })
  batchUpsertColumns(
    @Param('datasourceId') datasourceId: string,
    @Param('tableName') tableName: string,
    @Body() dto: BatchUpsertColumnMetadataDto,
  ) {
    return this.meta.batchUpsertColumnMeta(datasourceId, tableName, dto);
  }

  // -------- 业务术语词典 --------

  @Get('glossary')
  @ApiOperation({ summary: '业务术语列表' })
  listGlossary(@Param('datasourceId') datasourceId: string) {
    return this.meta.listGlossary(datasourceId);
  }

  @Post('glossary')
  @ApiOperation({ summary: '添加术语' })
  createGlossary(
    @Param('datasourceId') datasourceId: string,
    @Body() dto: GlossaryDto,
  ) {
    return this.meta.createGlossary(datasourceId, dto);
  }

  @Patch('glossary/:id')
  @ApiOperation({ summary: '修改术语' })
  updateGlossary(@Param('id') id: string, @Body() dto: GlossaryDto) {
    return this.meta.updateGlossary(id, dto);
  }

  @Delete('glossary/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除术语' })
  async deleteGlossary(@Param('id') id: string) {
    await this.meta.deleteGlossary(id);
  }

  // -------- 推荐问题 --------

  @Get('suggested-questions')
  @ApiOperation({ summary: '推荐问题列表' })
  listQuestions(@Param('datasourceId') datasourceId: string) {
    return this.meta.listQuestions(datasourceId);
  }

  @Post('suggested-questions')
  @ApiOperation({ summary: '添加推荐问题' })
  createQuestion(
    @Param('datasourceId') datasourceId: string,
    @Body() dto: SuggestedQuestionDto,
  ) {
    return this.meta.createQuestion(datasourceId, dto);
  }

  @Delete('suggested-questions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除推荐问题' })
  async deleteQuestion(@Param('id') id: string) {
    await this.meta.deleteQuestion(id);
  }
}
