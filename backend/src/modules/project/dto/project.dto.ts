import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, description: 'emoji 或 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiProperty({ required: false, description: '项目级 system 指令，会自动注入 Planner' })
  @IsOptional()
  @IsString()
  systemInstructions?: string;
}

export class UpdateProjectDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  systemInstructions?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  isActive?: boolean;
}

export class InviteMemberDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['admin', 'editor', 'viewer'] })
  @IsIn(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ['admin', 'editor', 'viewer'] })
  @IsIn(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}
