import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { OAuthService } from '../services/oauth.service';
import { Public } from '../decorators/public.decorator';
import { CurrentUser, AuthUser } from '../decorators/current-user.decorator';
import {
  ChangePasswordDto,
  EmailCodeDto,
  ForgotPasswordDto,
  LoginDto,
  OAuthCallbackDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from '../dto/auth.dto';
import { OAuthProvider } from '../../../database/entities';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
  ) {}

  // ============== 公开元信息 ==============

  @Public()
  @Get('providers')
  @ApiOperation({ summary: '前端探测可用登录方式（OAuth 未配置则不返回）' })
  getProviders() {
    return this.authService.getProviders();
  }

  // ============== 邮箱验证码 ==============

  @Public()
  @Post('email-code')
  @ApiOperation({ summary: '发送邮箱验证码（注册 / 找回密码 / 改邮箱共用）' })
  async sendEmailCode(@Body() dto: EmailCodeDto, @Req() req: Request) {
    return this.authService.requestEmailCode(dto.email, dto.purpose, this.ipOf(req));
  }

  // ============== 邮箱密码注册 / 登录 ==============

  @Public()
  @Post('register')
  @ApiOperation({ summary: '邮箱密码注册（需要邮箱验证码）' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register({
      email: dto.email,
      name: dto.name,
      password: dto.password,
      code: dto.code,
      ip: this.ipOf(req),
    });
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '邮箱密码登录' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.email, dto.password, this.ipOf(req));
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '用 refresh token 换新的 access token' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: '请求重置密码验证码' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.requestEmailCode(dto.email, 'reset_password', this.ipOf(req));
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: '凭验证码重置密码' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
    return { ok: true };
  }

  // ============== 已登录场景 ==============

  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({ summary: '修改密码（已登录）' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.id, dto.oldPassword, dto.newPassword);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '获取当前用户信息' })
  async me(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user.id);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: '更新当前用户姓名 / 头像' })
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: '登出（前端清 token；后端无需处理）' })
  logout() {
    return { ok: true };
  }

  // ============== OAuth ==============

  @Public()
  @Get('oauth/:provider/url')
  @ApiOperation({ summary: '获取第三方授权 URL' })
  oauthAuthorizeUrl(@Param('provider') provider: OAuthProvider, @Query('state') state?: string) {
    if (provider === 'google') return { url: this.oauthService.buildGoogleAuthUrl(state) };
    if (provider === 'feishu') return { url: this.oauthService.buildFeishuAuthUrl(state) };
    throw new Error(`unsupported provider: ${provider}`);
  }

  @Public()
  @Post('oauth/:provider/callback')
  @ApiOperation({ summary: 'OAuth 回调换 token' })
  async oauthCallback(
    @Param('provider') provider: OAuthProvider,
    @Body() dto: OAuthCallbackDto,
    @Req() req: Request,
  ) {
    const ip = this.ipOf(req);
    if (provider === 'google') return this.oauthService.handleGoogleCallback(dto.code, ip);
    if (provider === 'feishu') return this.oauthService.handleFeishuCallback(dto.code, ip);
    throw new Error(`unsupported provider: ${provider}`);
  }

  @ApiBearerAuth()
  @Get('oauth/bindings')
  @ApiOperation({ summary: '查当前用户已绑定的第三方账号' })
  async listBindings(@CurrentUser() user: AuthUser) {
    return this.oauthService.listBindings(user.id);
  }

  @ApiBearerAuth()
  @Delete('oauth/bindings/:provider')
  @ApiOperation({ summary: '解绑某个第三方账号' })
  async unbind(@CurrentUser() user: AuthUser, @Param('provider') provider: OAuthProvider) {
    await this.oauthService.unbind(user.id, provider);
    return { ok: true };
  }

  // ============== helpers ==============

  private ipOf(req: Request): string | undefined {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    return req.ip || undefined;
  }
}
