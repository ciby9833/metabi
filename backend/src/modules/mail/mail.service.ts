import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * MailService
 *
 * - 真发邮件：需要 MAIL_ENABLED=true 且 SMTP 配置齐全
 * - dev / 配置不全：所有邮件都打印到日志（验证码可见）
 *
 * 注：即使开启了真发邮件，验证码也会打印到日志（便于审计 + 排错）
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress = '';
  private fromName = 'ChatBI';
  private realSendEnabled = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const enabled = this.configService.get<boolean>('app.mail.enabled');
    const host = this.configService.get<string>('app.mail.host');
    const user = this.configService.get<string>('app.mail.user');
    const password = this.configService.get<string>('app.mail.password');

    this.fromAddress = this.configService.get<string>('app.mail.fromAddress') || 'noreply@example.com';
    this.fromName = this.configService.get<string>('app.mail.fromName') || 'ChatBI';

    if (!enabled || !host || !user || !password) {
      this.logger.warn(
        `MailService running in DEV mode (real email sending DISABLED). ` +
          `Reason: ${!enabled ? 'MAIL_ENABLED=false' : 'SMTP credentials missing'}. ` +
          `All emails will be printed to logs only.`,
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.configService.get<number>('app.mail.port') || 465,
      secure: this.configService.get<boolean>('app.mail.secure') !== false,
      auth: { user, pass: password },
    });

    try {
      await this.transporter.verify();
      this.realSendEnabled = true;
      this.logger.log(`MailService ready: real sending via ${host} as ${this.fromAddress}`);
    } catch (err) {
      this.transporter = null;
      this.logger.error(
        `SMTP verify failed (${(err as Error).message}); fallback to log-only mode.`,
      );
    }
  }

  isRealSendEnabled(): boolean {
    return this.realSendEnabled;
  }

  async sendEmailCode(email: string, code: string, purpose: 'register' | 'reset_password' | 'change_email'): Promise<void> {
    const titles: Record<string, string> = {
      register: '注册验证码',
      reset_password: '重置密码验证码',
      change_email: '邮箱变更验证码',
    };
    const subject = `【ChatBI】${titles[purpose] || '邮箱验证码'}：${code}`;
    const ttlMin = Math.round((this.configService.get<number>('app.mail.codeTtlSeconds') || 600) / 60);
    const html = renderCodeMail({
      title: titles[purpose] || '邮箱验证码',
      code,
      ttlMinutes: ttlMin,
    });

    // 始终打印日志（含验证码），便于审计排错
    this.logger.log(
      `[MAIL] To=${email} purpose=${purpose} code=${code} ttl=${ttlMin}min realSent=${this.realSendEnabled}`,
    );

    if (!this.realSendEnabled || !this.transporter) return;

    try {
      await this.transporter.sendMail({
        from: { name: this.fromName, address: this.fromAddress },
        to: email,
        subject,
        html,
        text: `您的 ${titles[purpose]} 是 ${code}，${ttlMin} 分钟内有效。`,
      });
    } catch (err) {
      this.logger.error(`Send mail failed (${(err as Error).message}); user can still read code from logs.`);
      // 不抛错。调用方已经把 code 存到 DB；用户可以从日志拿到（dev/紧急）
    }
  }
}

function renderCodeMail({ title, code, ttlMinutes }: { title: string; code: string; ttlMinutes: number }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: #f5f7fa;">
  <div style="max-width: 480px; margin: 0 auto; background: white; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    <h2 style="margin: 0 0 16px; color: #1f2329;">${title}</h2>
    <p style="color: #646a73; line-height: 1.6;">您正在进行邮箱验证。验证码如下，请在 <strong>${ttlMinutes} 分钟</strong> 内使用：</p>
    <div style="margin: 24px 0; padding: 20px; background: #f0f7ff; border-radius: 8px; text-align: center;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1677ff; font-family: 'SF Mono', Consolas, monospace;">${code}</span>
    </div>
    <p style="color: #8f959e; font-size: 12px; line-height: 1.5;">
      如果非您本人操作，请忽略此邮件。请勿将验证码告知他人。
    </p>
    <hr style="margin: 24px 0; border: 0; border-top: 1px solid #e5e6eb;">
    <p style="color: #8f959e; font-size: 12px; margin: 0;">ChatBI · 智能数据分析对话平台</p>
  </div>
</body></html>`;
}
