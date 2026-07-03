import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { User, UserOAuthBinding, OAuthProvider } from '../../../database/entities';
import { AuthResult, AuthService } from './auth.service';

/**
 * 第三方登录服务（Google + 飞书）
 *
 * 流程：
 *  1. 前端跳 /v1/auth/oauth/:provider/url → 拿到第三方授权 URL
 *  2. 用户在第三方授权 → 回调到前端 /auth/oauth/:provider/callback?code=...
 *  3. 前端拿 code 调 /v1/auth/oauth/:provider/callback → 后端换 token → 拿用户信息 → 找 / 建 user → 返回 JWT
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserOAuthBinding)
    private readonly bindingRepo: Repository<UserOAuthBinding>,
  ) {}

  // ============== Google ==============

  isGoogleEnabled(): boolean {
    const g = this.configService.get<any>('app.oauth.google');
    return !!(g?.clientId && g?.clientSecret);
  }

  buildGoogleAuthUrl(state?: string): string {
    if (!this.isGoogleEnabled()) throw new BadRequestException('Google 登录未配置');
    const g = this.configService.get<any>('app.oauth.google');
    const params = new URLSearchParams({
      client_id: g.clientId,
      redirect_uri: g.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      ...(state ? { state } : {}),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleGoogleCallback(code: string, ip?: string): Promise<AuthResult> {
    if (!this.isGoogleEnabled()) throw new BadRequestException('Google 登录未配置');
    const g = this.configService.get<any>('app.oauth.google');

    // 1) code → access_token
    let tokenResp;
    try {
      tokenResp = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: g.clientId,
          client_secret: g.clientSecret,
          redirect_uri: g.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 },
      );
    } catch (err: any) {
      this.logger.error(`Google token exchange failed: ${err.response?.data?.error_description || err.message}`);
      throw new BadRequestException('Google 授权失败，请重试');
    }
    const accessToken = tokenResp.data.access_token;

    // 2) access_token → userinfo
    const userResp = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    const info = userResp.data; // { sub, email, name, picture, email_verified, ... }
    if (!info.email) throw new BadRequestException('Google 账号未返回邮箱，无法登录');

    return this.findOrCreateOAuthUser({
      provider: 'google',
      providerUserId: info.sub,
      email: info.email,
      name: info.name || info.email,
      avatarUrl: info.picture,
      ip,
    });
  }

  // ============== 飞书 ==============

  isFeishuEnabled(): boolean {
    const f = this.configService.get<any>('app.oauth.feishu');
    return !!(f?.appId && f?.appSecret);
  }

  buildFeishuAuthUrl(state?: string): string {
    if (!this.isFeishuEnabled()) throw new BadRequestException('飞书登录未配置');
    const f = this.configService.get<any>('app.oauth.feishu');
    const params = new URLSearchParams({
      app_id: f.appId,
      redirect_uri: f.redirectUri,
      response_type: 'code',
      ...(state ? { state } : {}),
    });
    return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`;
  }

  async handleFeishuCallback(code: string, ip?: string): Promise<AuthResult> {
    if (!this.isFeishuEnabled()) throw new BadRequestException('飞书登录未配置');
    const f = this.configService.get<any>('app.oauth.feishu');

    // 飞书流程：1) app_access_token  2) user_access_token  3) user_info
    let appToken: string;
    try {
      const tokenResp = await axios.post(
        'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
        { app_id: f.appId, app_secret: f.appSecret },
        { timeout: 10000 },
      );
      if (tokenResp.data.code !== 0) {
        throw new Error(`app_access_token: ${tokenResp.data.msg}`);
      }
      appToken = tokenResp.data.app_access_token;
    } catch (err: any) {
      this.logger.error(`Feishu app_access_token failed: ${err.message}`);
      throw new BadRequestException('飞书认证失败：无法获取 app token');
    }

    let userToken: string;
    try {
      const r = await axios.post(
        'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
        { grant_type: 'authorization_code', code },
        { headers: { Authorization: `Bearer ${appToken}` }, timeout: 10000 },
      );
      if (r.data.code !== 0) {
        throw new Error(`user_access_token: ${r.data.msg}`);
      }
      userToken = r.data.data.access_token;
    } catch (err: any) {
      this.logger.error(`Feishu user_access_token failed: ${err.message}`);
      throw new BadRequestException('飞书授权失败，请重试');
    }

    let info: any;
    try {
      const r = await axios.get('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        headers: { Authorization: `Bearer ${userToken}` },
        timeout: 10000,
      });
      if (r.data.code !== 0) {
        throw new Error(`user_info: ${r.data.msg}`);
      }
      info = r.data.data; // { union_id, open_id, email, enterprise_email, name, avatar_url ... }
    } catch (err: any) {
      this.logger.error(`Feishu user_info failed: ${err.message}`);
      throw new BadRequestException('飞书登录失败：无法获取用户信息');
    }

    const email = info.email || info.enterprise_email;
    if (!email) {
      throw new BadRequestException('飞书账号没有邮箱信息，无法登录');
    }
    return this.findOrCreateOAuthUser({
      provider: 'feishu',
      providerUserId: info.union_id || info.open_id,
      email,
      name: info.name || email,
      avatarUrl: info.avatar_url,
      ip,
    });
  }

  // ============== 通用：找用户 / 建用户 / 绑定 ==============

  private async findOrCreateOAuthUser(input: {
    provider: OAuthProvider;
    providerUserId: string;
    email: string;
    name: string;
    avatarUrl?: string;
    ip?: string;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    // 1) 优先按 provider+providerUserId 找已绑定的
    const existedBinding = await this.bindingRepo.findOne({
      where: { provider: input.provider, providerUserId: input.providerUserId },
    });
    if (existedBinding) {
      const u = await this.userRepo.findOne({ where: { id: existedBinding.userId } });
      if (!u || !u.isActive) throw new BadRequestException('账号已停用');
      await this.authService.updateLastLogin(u, input.ip);
      return this.authService.buildAuthResult(u);
    }

    // 2) 按邮箱找已有 user → 自动绑定
    let user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      // 3) 新建用户（无密码，emailVerified=true 因为第三方已验证）
      user = await this.userRepo.save(
        this.userRepo.create({
          email,
          name: input.name,
          passwordHash: null,
          emailVerifiedAt: new Date(),
          avatarUrl: input.avatarUrl || null,
          isActive: true,
          isAdmin: false,
        }),
      );
      this.logger.log(`Created new user via ${input.provider}: ${email} (${user.id})`);
    }

    await this.bindingRepo.save(
      this.bindingRepo.create({
        userId: user.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        providerEmail: email,
        providerName: input.name,
        providerAvatarUrl: input.avatarUrl || null,
      }),
    );

    await this.authService.updateLastLogin(user, input.ip);
    return this.authService.buildAuthResult(user);
  }

  async listBindings(userId: string) {
    const rows = await this.bindingRepo.find({ where: { userId } });
    return rows.map((b) => ({
      provider: b.provider,
      providerEmail: b.providerEmail,
      providerName: b.providerName,
      connectedAt: b.createdAt,
    }));
  }

  async unbind(userId: string, provider: OAuthProvider) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('用户不存在');
    // 不允许解绑唯一登录方式
    if (!user.passwordHash) {
      const others = await this.bindingRepo.count({
        where: { userId, provider: provider === 'google' ? 'feishu' : 'google' },
      });
      if (others === 0) {
        throw new BadRequestException('账号没有设置密码，且只剩这一种登录方式，无法解绑');
      }
    }
    await this.bindingRepo.delete({ userId, provider });
  }
}
