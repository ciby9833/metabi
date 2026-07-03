import {
  IsString,
  IsEnum,
  IsObject,
  IsOptional,
  IsBoolean,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DatasourceType } from '../../../database/entities';

export class CreateDatasourceDto {
  @ApiProperty({ description: '数据源名称' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: DatasourceType, description: '数据源类型' })
  @IsEnum(DatasourceType)
  type: DatasourceType;

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '连接配置（host/port/database/username/password 等）' })
  @IsObject()
  config: Record<string, any>;

  @ApiPropertyOptional({ description: '关联的语义层数据集名称列表' })
  @IsOptional()
  @IsArray()
  datasetNames?: string[];
}

export class TestConnectionDto {
  @ApiProperty({ enum: DatasourceType })
  @IsEnum(DatasourceType)
  type: DatasourceType;

  @ApiProperty()
  @IsObject()
  config: Record<string, any>;
}

export class UpdateDatasourceDto {
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
  @IsObject()
  config?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  datasetNames?: string[];
}
