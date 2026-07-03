import {
  IsString,
  IsOptional,
  IsUUID,
  IsBoolean,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '用户提问的自然语言' })
  @IsString()
  question: string;

  @ApiProperty({ description: 'cron 表达式，例如 0 9 * * *（每天 9 点）' })
  @IsString()
  cronExpression: string;

  @ApiProperty()
  @IsUUID()
  datasourceId: string;

  @ApiPropertyOptional({ description: '飞书机器人 Webhook' })
  @IsOptional()
  @IsString()
  feishuWebhook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '失败重试次数', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  retryCount?: number;
}

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  question?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
