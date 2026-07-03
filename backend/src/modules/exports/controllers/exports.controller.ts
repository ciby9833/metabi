import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as fs from 'fs';
import { FileStorageService } from '../services/file-storage.service';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
export class ExportsController {
  constructor(private readonly storage: FileStorageService) {}

  /** 列出当前 user 的所有导出文件（可选按 conversation 过滤）*/
  @Get()
  @ApiOperation({ summary: '我的导出文件列表' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query('conversationId') conversationId?: string,
  ) {
    const files = conversationId
      ? await this.storage.listForConversation(conversationId, user.id)
      : await this.storage.listForUser(user.id);
    return files.map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: Number(f.sizeBytes),
      description: f.description,
      conversationId: f.conversationId,
      messageId: f.messageId,
      createdAt: f.createdAt,
    }));
  }

  /** 下载单个文件 — 权限校验后 streaming 返回 */
  @Get(':id/download')
  @ApiOperation({ summary: '下载文件' })
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') fileId: string,
    @Res() res: Response,
  ) {
    const { file, absPath } = await this.storage.getForDownload(fileId, user.id);
    const stat = fs.statSync(absPath);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', stat.size.toString());
    // UTF-8 文件名兼容：filename* 用 RFC5987 编码
    const encoded = encodeURIComponent(file.filename);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    );
    fs.createReadStream(absPath).pipe(res);
  }
}
