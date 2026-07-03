import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ExportedFile, Conversation } from '../../../database/entities';
import { ProjectService } from '../../project/services/project.service';

interface SaveInput {
  ownerId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  conversationId?: string;
  messageId?: string;
  description?: string;
}

/**
 * 文件存储服务 — 持久化 AI 生成的导出文件
 *
 * 设计：
 *   - 本地 disk MVP（DATA_ROOT/exports/<ownerId>/<fileId>.<ext>）
 *   - Service 接口隔离，未来切 S3 不破坏调用方
 *   - 50MB 上限（与 dataset upload 对齐）
 *   - 权限：owner 自己可读；若挂在 conversation 上且是 project conv，则 member 可读
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly maxBytes = 50 * 1024 * 1024;
  private readonly rootDir: string;

  constructor(
    @InjectRepository(ExportedFile)
    private readonly repo: Repository<ExportedFile>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    private readonly projectService: ProjectService,
    config: ConfigService,
  ) {
    const root = config.get<string>('EXPORT_DIR') || path.join(process.cwd(), 'data', 'exports');
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    this.rootDir = root;
    this.logger.log(`File storage root: ${root}`);
  }

  /** 写文件 + 落 DB；返回 ExportedFile entity */
  async save(input: SaveInput): Promise<ExportedFile> {
    if (input.buffer.byteLength > this.maxBytes) {
      throw new Error(`File exceeds ${this.maxBytes / 1024 / 1024}MB limit`);
    }
    const fileId = randomUUID();
    const ext = path.extname(input.filename) || '.bin';
    const ownerDir = path.join(this.rootDir, input.ownerId);
    if (!fs.existsSync(ownerDir)) fs.mkdirSync(ownerDir, { recursive: true });
    const storagePath = path.join(input.ownerId, `${fileId}${ext}`);
    const absPath = path.join(this.rootDir, storagePath);
    fs.writeFileSync(absPath, input.buffer);

    const row = this.repo.create({
      id: fileId,
      ownerId: input.ownerId,
      conversationId: input.conversationId || null,
      messageId: input.messageId || null,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
      storagePath,
      description: input.description || null,
    });
    const saved = await this.repo.save(row);
    this.logger.log(
      `Saved ${input.filename} (${input.buffer.byteLength}B) → ${storagePath} for user=${input.ownerId}`,
    );
    return saved;
  }

  /** 拿到文件元数据 + 绝对路径；权限校验 */
  async getForDownload(
    fileId: string,
    userId: string,
  ): Promise<{ file: ExportedFile; absPath: string }> {
    const file = await this.repo.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException('文件不存在');
    await this.assertCanAccess(file, userId);
    const absPath = path.join(this.rootDir, file.storagePath);
    if (!fs.existsSync(absPath)) {
      throw new NotFoundException('文件已删除或损坏');
    }
    return { file, absPath };
  }

  async listForUser(userId: string, conversationId?: string): Promise<ExportedFile[]> {
    const where = conversationId
      ? { ownerId: userId, conversationId }
      : { ownerId: userId };
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 100 });
  }

  async listForConversation(conversationId: string, userId: string): Promise<ExportedFile[]> {
    // 权限：能访问该对话即能看其附件
    const conv = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conv) return [];
    if (conv.userId !== userId) {
      if (conv.projectId) {
        const canAccess = await this.projectService.canAccess(conv.projectId, userId);
        if (!canAccess) throw new ForbiddenException('无权访问该对话的附件');
      } else {
        throw new ForbiddenException('无权访问该对话的附件');
      }
    }
    return this.repo.find({ where: { conversationId }, order: { createdAt: 'DESC' } });
  }

  private async assertCanAccess(file: ExportedFile, userId: string): Promise<void> {
    if (file.ownerId === userId) return;
    if (file.conversationId) {
      const conv = await this.conversationRepo.findOne({ where: { id: file.conversationId } });
      if (conv?.projectId) {
        const ok = await this.projectService.canAccess(conv.projectId, userId);
        if (ok) return;
      }
    }
    throw new ForbiddenException('无权下载该文件');
  }
}
