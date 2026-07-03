import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class EmailCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['register', 'reset_password', 'change_email'] })
  @IsIn(['register', 'reset_password', 'change_email'])
  purpose: 'register' | 'reset_password' | 'change_email';
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: '邮箱验证码（开启 requireEmailCode 时必填）', required: false })
  @IsOptional()
  @IsString()
  code?: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  oldPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class UpdateProfileDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({ required: false, description: '部门，如"财务部" — 给 LLM 软上下文用' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({ required: false, description: '职能角色，如"分析师" — 给 LLM 软上下文用' })
  @IsOptional()
  @IsString()
  jobRole?: string;
}

export class OAuthCallbackDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  state?: string;
}
