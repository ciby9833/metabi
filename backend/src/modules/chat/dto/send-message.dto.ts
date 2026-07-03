import { IsString, IsOptional, IsUUID, IsBoolean, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: '用户提问的自然语言' })
  @IsString()
  @MaxLength(2000)
  message: string;

  @ApiProperty({ description: '关联的数据源 ID（企业 DB 连接），或当 datasetIds 非空时复用为应用 PG' })
  @IsUUID()
  datasourceId: string;

  @ApiPropertyOptional({
    description:
      '用户上传 dataset 模式：指定 1-N 个 datasetId（隔离白名单，避免跨用户泄漏）。' +
      '非空时 Planner 跳过 Skill.tables，allowedTables 只含这些 dataset 表。',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  datasetIds?: string[];

  @ApiPropertyOptional({
    description:
      '企业模式的「分析范围」— 用户预先选定的表（含 schema，如 "dwd.orders"）。' +
      '非空时作为 Planner 白名单 override，帮 LLM 跳过 list_tables 探索。',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  analyzedTables?: string[];

  @ApiPropertyOptional({ description: '对话 ID，缺省则创建新对话' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ description: '关联的 Project ID（仅在新建对话时生效）' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: '对话模式（仅新建时生效）：single_skill / master' })
  @IsOptional()
  @IsString()
  mode?: 'single_skill' | 'master';

  // clarifyReplyToMessageId 已删 — SSE 路径下 clarify 走 generator 内置 yield/resume，无需前端传

  @ApiPropertyOptional({ description: '是否启用向量检索（默认关键词检索）' })
  @IsOptional()
  @IsBoolean()
  useVectorRetrieval?: boolean;

  @ApiPropertyOptional({
    description:
      '本次消息附带的 chat_attachments id 列表 —— 已通过 POST /v1/chat/attachments 上传',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  attachmentIds?: string[];
}

export class CreateConversationDto {
  @ApiPropertyOptional({ description: '对话标题' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: '关联的数据源 ID' })
  @IsOptional()
  @IsUUID()
  datasourceId?: string;

  @ApiPropertyOptional({ description: '关联的 Project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
