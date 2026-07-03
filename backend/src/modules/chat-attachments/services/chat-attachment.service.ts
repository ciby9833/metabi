import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ChatAttachment } from '../../../database/entities';
import { AttachmentParserService } from './attachment-parser.service';

@Injectable()
export class ChatAttachmentService {
  private readonly logger = new Logger(ChatAttachmentService.name);
  private readonly storageRoot: string;

  constructor(
    @InjectRepository(ChatAttachment)
    private readonly repo: Repository<ChatAttachment>,
    private readonly parser: AttachmentParserService,
  ) {
    this.storageRoot =
      process.env.CHAT_ATTACHMENT_DIR ||
      path.join(process.cwd(), 'storage', 'chat-attachments');
    if (!fs.existsSync(this.storageRoot)) {
      fs.mkdirSync(this.storageRoot, { recursive: true });
    }
  }

  async upload(file: Express.Multer.File, userId: string): Promise<ChatAttachment> {
    if (!file || !file.buffer) throw new BadRequestException('文件为空');

    // 存磁盘 —— 按日期分目录避免单目录太多文件
    const now = new Date();
    const subDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const fullDir = path.join(this.storageRoot, subDir);
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

    const ext = path.extname(file.originalname) || this.extFromMime(file.mimetype);
    const filename = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    const relPath = path.join(subDir, filename);
    const absPath = path.join(this.storageRoot, relPath);
    fs.writeFileSync(absPath, file.buffer);

    // 解析
    let parsed;
    try {
      parsed = await this.parser.parse(absPath, file.originalname, file.mimetype);
    } catch (err) {
      this.logger.warn(`Parse failed for ${file.originalname}: ${(err as Error).message}`);
      // 走 text 兜底
      parsed = { kind: 'text' as const, preview: { textPreview: '(解析失败)', lineCount: 0 } };
    }

    const record = await this.repo.save(
      this.repo.create({
        ownerId: userId,
        messageId: null, // 发消息时才关联
        kind: parsed.kind,
        filename: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        storagePath: relPath,
        preview: parsed.preview,
      }),
    );
    this.logger.log(
      `Upload attachment ${record.id} kind=${record.kind} size=${record.sizeBytes} by ${userId}`,
    );
    return record;
  }

  async findAccessible(ids: string[], userId: string): Promise<ChatAttachment[]> {
    if (!ids || ids.length === 0) return [];
    const list = await this.repo.find({ where: { id: In(ids) } });
    for (const a of list) {
      if (a.ownerId !== userId) throw new ForbiddenException('无权访问附件');
    }
    return list;
  }

  /** 把附件绑到某条 message —— 发消息完成后调 */
  async attachToMessage(ids: string[], messageId: string, userId: string): Promise<void> {
    if (!ids || ids.length === 0) return;
    const list = await this.findAccessible(ids, userId);
    for (const a of list) {
      a.messageId = messageId;
      await this.repo.save(a);
    }
  }

  async readFileBuffer(attachment: ChatAttachment): Promise<Buffer> {
    const abs = path.join(this.storageRoot, attachment.storagePath);
    if (!fs.existsSync(abs)) throw new NotFoundException('附件文件已丢失');
    return fs.readFileSync(abs);
  }

  private extFromMime(mime: string): string {
    if (mime.startsWith('image/png')) return '.png';
    if (mime.startsWith('image/jpeg')) return '.jpg';
    if (mime.startsWith('image/webp')) return '.webp';
    if (mime === 'application/pdf') return '.pdf';
    if (mime === 'text/csv') return '.csv';
    return '';
  }
}
