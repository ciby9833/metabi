import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { EmailVerification, EmailVerificationPurpose, User } from '../../../database/entities';
import { MailService } from '../../mail/mail.service';

const BCRYPT_ROUNDS = 10;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult extends TokenPair {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    isAdmin: boolean;
    emailVerified: boolean;
  };
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EmailVerification)
    private readonly codeRepo: Repository<EmailVerification>,
  ) {}

  /** 启动时确保系统管理员账号存在（默认密码已 hash 写在源码里，仅作为 bootstrap） */
  async onModuleInit() {
    try {
      await this.ensureBootstrapAdmin();
    } catch (err) {
      this.logger.error(`Bootstrap admin failed: ${(err as Error).message}`);
    }
  }

  private async ensureBootstrapAdmin() {
    const email = 'noelgfr@gmail.com';
    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) {
      // 已存在 → 仅确保 admin 标志 + active，不动密码
      if (!existing.isAdmin || !existing.isActive) {
        existing.isAdmin = true;
        existing.isActive = true;
        await this.userRepo.save(existing);
        this.logger.log(`Bootstrap admin re-elevated: ${email}`);
      }
      return;
    }
    const passwordHash = await bcrypt.hash('xiaotao4vip', BCRYPT_ROUNDS);
    await this.userRepo.save(
      this.userRepo.create({
        email,
        name: '系统管理员',
        passwordHash,
        emailVerifiedAt: new Date(),
        isAdmin: true,
        isActive: true,
      }),
    );
    this.logger.log(`Bootstrap admin created: ${email} (password: xiaotao4vip — change ASAP)`);
  }

  // ============== 公开能力 ==============

  getProviders() {
    const g = this.configService.get<any>('app.oauth.google');
    const f = this.configService.get<any>('app.oauth.feishu');
    return {
      password: true,
      register: this.configService.get<boolean>('app.auth.registrationEnabled'),
      google: !!(g?.clientId && g?.clientSecret),
      feishu: !!(f?.appId && f?.appSecret),
      requireEmailCode: this.configService.get<boolean>('app.auth.requireEmailCode'),
    };
  }

  // ============== 验证码 ==============

  async requestEmailCode(email: string, purpose: EmailVerificationPurpose, ip?: string): Promise<{ ttlSeconds: number; devCode?: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    this.validateEmail(normalizedEmail);

    if (purpose === 'register') {
      const existing = await this.userRepo.findOne({ where: { email: normalizedEmail } });
      if (existing) throw new BadRequestException('该邮箱已注册，请直接登录');
      this.assertEmailDomainAllowed(normalizedEmail);
    } else if (purpose === 'reset_password') {
      const existing = await this.userRepo.findOne({ where: { email: normalizedEmail } });
      if (!existing) {
        // 安全：避免泄露注册状态，假装成功
        await sleep(300);
        return { ttlSeconds: this.codeTtl };
      }
    }

    await this.assertCooldown(normalizedEmail, purpose);
    await this.assertDailyLimit(normalizedEmail);

    const code = generateCode(6);
    const expiresAt = new Date(Date.now() + this.codeTtl * 1000);
    await this.codeRepo.save(
      this.codeRepo.create({
        email: normalizedEmail,
        code,
        purpose,
        expiresAt,
        requestIp: ip || null,
      }),
    );

    await this.mailService.sendEmailCode(normalizedEmail, code, purpose);

    // dev 模式返回 code 方便前端测试。生产环境永不返回
    const devCode = this.mailService.isRealSendEnabled() ? undefined : code;
    return { ttlSeconds: this.codeTtl, devCode };
  }

  // ============== 注册 ==============

  async register(input: {
    email: string;
    password: string;
    name: string;
    code?: string;
    ip?: string;
  }): Promise<AuthResult> {
    if (!this.configService.get<boolean>('app.auth.registrationEnabled')) {
      throw new ForbiddenException('注册功能已关闭');
    }
    const email = this.normalizeEmail(input.email);
    this.validateEmail(email);
    this.assertEmailDomainAllowed(email);
    this.validatePassword(input.password);
    if (!input.name?.trim()) throw new BadRequestException('请填写姓名');

    const dup = await this.userRepo.findOne({ where: { email } });
    if (dup) throw new BadRequestException('该邮箱已注册');

    if (this.configService.get<boolean>('app.auth.requireEmailCode')) {
      if (!input.code) throw new BadRequestException('请输入邮箱验证码');
      await this.consumeCode(email, input.code, 'register');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.userRepo.save(
      this.userRepo.create({
        email,
        name: input.name.trim(),
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
        isAdmin: false,
      }),
    );
    this.logger.log(`Registered new user: ${email} (${user.id})`);
    await this.updateLastLogin(user, input.ip);
    return this.buildAuthResult(user);
  }

  // ============== 登录 ==============

  async login(email: string, password: string, ip?: string): Promise<AuthResult> {
    const normalized = this.normalizeEmail(email);
    const user = await this.userRepo.findOne({ where: { email: normalized } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('该账号通过第三方登录创建，请使用第三方登录或先找回密码');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('邮箱或密码错误');
    await this.updateLastLogin(user, ip);
    return this.buildAuthResult(user);
  }

  // ============== refresh ==============

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('app.jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('refresh token 无效或已过期');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('token 类型错误');
    }
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('用户不存在或已停用');
    return this.signTokens(user);
  }

  // ============== 密码找回 / 修改 ==============

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const normalized = this.normalizeEmail(email);
    this.validatePassword(newPassword);
    await this.consumeCode(normalized, code, 'reset_password');
    const user = await this.userRepo.findOne({ where: { email: normalized } });
    if (!user) throw new NotFoundException('用户不存在');
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepo.save(user);
    this.logger.log(`Password reset for ${normalized}`);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    this.validatePassword(newPassword);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.passwordHash) {
      const ok = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!ok) throw new BadRequestException('原密码错误');
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepo.save(user);
  }

  // ============== me / profile ==============

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      emailVerified: !!user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      hasPassword: !!user.passwordHash,
      // 给 LLM 注入的软上下文（Settings 可填可不填）
      department: user.department ?? null,
      jobRole: user.jobRole ?? null,
    };
  }

  async updateProfile(
    userId: string,
    dto: { name?: string; avatarUrl?: string; department?: string; jobRole?: string },
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('姓名不能为空');
      user.name = dto.name.trim();
    }
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl || null;
    // department / jobRole: 空字符串 = 清空
    if (dto.department !== undefined) {
      user.department = dto.department.trim() || null;
    }
    if (dto.jobRole !== undefined) {
      user.jobRole = dto.jobRole.trim() || null;
    }
    await this.userRepo.save(user);
    return this.getMe(userId);
  }

  // ============== 内部 helper ==============

  buildAuthResult(user: User): AuthResult {
    const tokens = this.signTokens(user);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        emailVerified: !!user.emailVerifiedAt,
      },
    };
  }

  signTokens(user: User): TokenPair {
    const accessSecret = this.configService.get<string>('app.jwt.secret');
    const refreshSecret = this.configService.get<string>('app.jwt.refreshSecret');
    const accessExpires = this.configService.get<string>('app.jwt.expiresIn') || '15m';
    const refreshExpires = this.configService.get<string>('app.jwt.refreshExpiresIn') || '30d';

    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'access' },
      { secret: accessSecret, expiresIn: accessExpires },
    );
    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      { secret: refreshSecret, expiresIn: refreshExpires },
    );

    return { accessToken, refreshToken, expiresIn: parseExpiresToSeconds(accessExpires) };
  }

  async updateLastLogin(user: User, ip?: string) {
    user.lastLoginAt = new Date();
    if (ip) user.lastLoginIp = ip;
    await this.userRepo.save(user);
  }

  private async consumeCode(email: string, code: string, purpose: EmailVerificationPurpose) {
    const row = await this.codeRepo
      .createQueryBuilder('c')
      .where(
        'c.email = :email AND c.code = :code AND c.purpose = :purpose AND c.consumed_at IS NULL',
        { email, code, purpose },
      )
      .orderBy('c.created_at', 'DESC')
      .limit(1)
      .getOne();
    if (!row) throw new BadRequestException('验证码错误或已使用');
    if (row.expiresAt < new Date()) throw new BadRequestException('验证码已过期');
    row.consumedAt = new Date();
    await this.codeRepo.save(row);
  }

  private get codeTtl(): number {
    return this.configService.get<number>('app.mail.codeTtlSeconds') || 600;
  }

  private async assertCooldown(email: string, purpose: EmailVerificationPurpose) {
    const cooldown = this.configService.get<number>('app.mail.codeCooldownSeconds') || 60;
    const latest = await this.codeRepo
      .createQueryBuilder('c')
      .where('c.email = :email AND c.purpose = :purpose', { email, purpose })
      .orderBy('c.created_at', 'DESC')
      .limit(1)
      .getOne();
    if (latest && Date.now() - latest.createdAt.getTime() < cooldown * 1000) {
      const remain = cooldown - Math.floor((Date.now() - latest.createdAt.getTime()) / 1000);
      throw new BadRequestException(`发送过于频繁，请 ${remain} 秒后重试`);
    }
  }

  private async assertDailyLimit(email: string) {
    const limit = this.configService.get<number>('app.mail.codeDailyLimit') || 10;
    const since = new Date(Date.now() - ONE_DAY_MS);
    const count = await this.codeRepo.count({ where: { email, createdAt: MoreThan(since) } });
    if (count >= limit) {
      throw new BadRequestException(`该邮箱今日验证码发送已达上限（${limit} 次），请明日再试`);
    }
  }

  private normalizeEmail(email: string): string {
    return (email || '').trim().toLowerCase();
  }

  private validateEmail(email: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }
  }

  private assertEmailDomainAllowed(email: string) {
    const allowed = this.configService.get<string[]>('app.auth.allowedEmailDomains') || [];
    if (allowed.length === 0) return;
    const domain = email.split('@')[1];
    if (!allowed.includes(domain)) {
      throw new ForbiddenException(`仅允许以下邮箱域名注册：${allowed.join(', ')}`);
    }
  }

  private validatePassword(pwd: string) {
    if (!pwd || pwd.length < 8) throw new BadRequestException('密码至少 8 位');
    if (pwd.length > 128) throw new BadRequestException('密码过长（最多 128 位）');
  }

  async cleanupExpiredCodes(): Promise<number> {
    const res = await this.codeRepo.delete({ expiresAt: LessThan(new Date(Date.now() - ONE_DAY_MS)) });
    return res.affected || 0;
  }
}

function generateCode(len = 6): string {
  const num = crypto.randomInt(0, Math.pow(10, len));
  return String(num).padStart(len, '0');
}

function parseExpiresToSeconds(expires: string): number {
  const m = expires.match(/^(\d+)([smhd])$/);
  if (!m) return 900;
  const v = parseInt(m[1], 10);
  switch (m[2]) {
    case 's': return v;
    case 'm': return v * 60;
    case 'h': return v * 3600;
    case 'd': return v * 86400;
  }
  return 900;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
