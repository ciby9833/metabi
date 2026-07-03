import { Global, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { ChatAttachment } from '../../database/entities';
import { AttachmentParserService } from './services/attachment-parser.service';
import { ChatAttachmentService } from './services/chat-attachment.service';
import { ChatAttachmentController } from './controllers/chat-attachment.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatAttachment]),
    MulterModule.register({ storage: memoryStorage() }),
  ],
  providers: [AttachmentParserService, ChatAttachmentService],
  controllers: [ChatAttachmentController],
  exports: [AttachmentParserService, ChatAttachmentService],
})
export class ChatAttachmentsModule {}
