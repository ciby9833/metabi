import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './controllers/chat.controller';
import { ChatStreamController } from './controllers/chat-stream.controller';
import { ChatService } from './services/chat.service';
import { MessageFeedbackService } from './services/feedback.service';
import { TurnRecallService } from './services/turn-recall.service';
import { ChatExportService } from './services/export.service';
import {
  Conversation,
  Datasource,
  Message,
  MessageFeedback,
  SuggestedQuestion,
  TurnArtifact,
} from '../../database/entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Datasource,
      Message,
      MessageFeedback,
      SuggestedQuestion,
      TurnArtifact,
    ]),
  ],
  controllers: [ChatController, ChatStreamController],
  providers: [ChatService, MessageFeedbackService, TurnRecallService, ChatExportService],
  exports: [ChatService, MessageFeedbackService, TurnRecallService, ChatExportService],
})
export class ChatModule {}
