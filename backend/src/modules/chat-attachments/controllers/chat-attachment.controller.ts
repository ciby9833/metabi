import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { ChatAttachmentService } from '../services/chat-attachment.service';

@ApiTags('chat-attachments')
@Controller('chat/attachments')
export class ChatAttachmentController {
  constructor(private readonly svc: ChatAttachmentService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({
    summary: '上传 chat 附件 — 图片/CSV/Excel/PDF/文本；返回 id + kind + preview',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    const a = await this.svc.upload(file, user.id);
    return {
      id: a.id,
      kind: a.kind,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      preview: a.preview,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '取单个附件元数据 — 供消息重打开时展示' })
  async getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const list = await this.svc.findAccessible([id], user.id);
    const a = list[0];
    return {
      id: a.id,
      kind: a.kind,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      preview: a.preview,
    };
  }

  @Get(':id/raw')
  @ApiOperation({ summary: '取附件原始字节 —— 前端可 fetch 后转 blob URL 展示缩略图/预览' })
  async raw(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const list = await this.svc.findAccessible([id], user.id);
    const a = list[0];
    const buf = await this.svc.readFileBuffer(a);

    res.setHeader('Content-Type', a.mimeType || 'application/octet-stream');
    // 允许浏览器缓存一段时间；私有 = 不走 CDN
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // inline 让浏览器直接展示（image/pdf 等），不触发下载
    const asciiFallback = a.filename.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    );
    res.end(buf);
  }
}
