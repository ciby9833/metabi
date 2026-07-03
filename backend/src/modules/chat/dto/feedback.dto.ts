import { IsEnum, IsOptional, IsBoolean, IsString, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedbackType } from '../../../database/entities';

export class SubmitFeedbackDto {
  @ApiProperty({ enum: FeedbackType, description: 'good = 赞 / bad = 踩' })
  @IsEnum(FeedbackType)
  type: FeedbackType;

  @ApiPropertyOptional({ description: '附加说明，bad 时建议必填' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'good 模式下：是否将此问答沉淀为推荐问题模板（learned）',
  })
  @IsOptional()
  @IsBoolean()
  saveAsTemplate?: boolean;

  @ApiPropertyOptional({ description: '模板排序优先级（saveAsTemplate=true 时生效）' })
  @IsOptional()
  @IsNumber()
  templatePriority?: number;
}
