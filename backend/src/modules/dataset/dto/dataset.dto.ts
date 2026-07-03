import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DatasetColumnDto {
  @ApiProperty()
  @IsString()
  @MaxLength(63)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originalName?: string;

  @ApiProperty({ enum: ['text', 'integer', 'numeric', 'boolean', 'timestamp', 'date'] })
  @IsIn(['text', 'integer', 'numeric', 'boolean', 'timestamp', 'date'])
  type: 'text' | 'integer' | 'numeric' | 'boolean' | 'timestamp' | 'date';

  @ApiPropertyOptional({ description: '业务描述（注入 Planner prompt 让 LLM 知道列含义）'})
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}

export class ConfirmDatasetDto {
  @ApiPropertyOptional({ description: '展示名（默认 = filename）'})
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: '数据集整体业务描述' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: '挂到哪个项目 — null 表示个人；非空时该项目成员都可查询',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @ApiProperty({ type: [DatasetColumnDto], description: '用户编辑后的列定义' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DatasetColumnDto)
  columns: DatasetColumnDto[];
}

export class UpdateDatasetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: '改归属：传 null 改回个人；传 uuid 挂到该项目（需是该项目成员）',
  })
  @IsOptional()
  projectId?: string | null;
}
