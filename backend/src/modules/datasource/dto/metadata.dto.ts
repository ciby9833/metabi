import { IsString, IsOptional, IsArray, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertTableMetadataDto {
  @ApiPropertyOptional() @IsOptional() @IsString() businessName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() timezone?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  synonyms?: string[];
}

export class UpsertColumnMetadataDto {
  @ApiProperty() @IsString() columnName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() businessName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  synonyms?: string[];
}

export class BatchUpsertColumnMetadataDto {
  @ApiProperty({ type: [UpsertColumnMetadataDto] })
  @IsArray()
  columns: UpsertColumnMetadataDto[];
}

export class GlossaryDto {
  @ApiProperty() @IsString() term: string;
  @ApiProperty() @IsString() meaning: string;
  @ApiPropertyOptional() @IsOptional() @IsString() exampleSql?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  appliesToTables?: string[];
}

export class SuggestedQuestionDto {
  @ApiProperty() @IsString() questionText: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() learnedSql?: string;
}
