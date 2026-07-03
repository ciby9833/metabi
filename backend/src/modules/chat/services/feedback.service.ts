import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Conversation,
  FeedbackType,
  Message,
  MessageFeedback,
  MessageRole,
  SuggestedQuestion,
} from '../../../database/entities';
import { SubmitFeedbackDto } from '../dto/feedback.dto';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class MessageFeedbackService {
  private readonly logger = new Logger(MessageFeedbackService.name);

  constructor(
    @InjectRepository(MessageFeedback)
    private readonly feedbackRepo: Repository<MessageFeedback>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(SuggestedQuestion)
    private readonly suggestedRepo: Repository<SuggestedQuestion>,
  ) {}

  /**
   * 提交反馈
   * - good + saveAsTemplate=true：沉淀为 SuggestedQuestion (source=learned)
   * - bad：仅记录，工程师在管理后台审查
   */
  async submit(
    messageId: string,
    dto: SubmitFeedbackDto,
    userId?: string,
  ): Promise<MessageFeedback> {
    const uid = userId || DEFAULT_USER_ID;

    // 1) 检查 assistant 消息存在
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.role !== MessageRole.ASSISTANT) {
      throw new Error('Only assistant messages can be rated');
    }

    let savedAsTemplate = false;

    // 2) good + saveAsTemplate → 沉淀为 SuggestedQuestion
    if (dto.type === FeedbackType.GOOD && dto.saveAsTemplate) {
      const conversation = await this.conversationRepo.findOne({
        where: { id: message.conversationId },
      });
      if (!conversation?.datasourceId) {
        this.logger.warn(
          `Cannot save as template: conversation ${message.conversationId} has no datasourceId`,
        );
      } else {
        // 找到本轮对应的 user 消息（在 assistant 之前的最近一条 user）
        const allMessages = await this.messageRepo.find({
          where: { conversationId: message.conversationId },
          order: { createdAt: 'ASC' },
        });
        const idx = allMessages.findIndex((m) => m.id === messageId);
        const userMsg = allMessages
          .slice(0, idx)
          .reverse()
          .find((m) => m.role === MessageRole.USER);

        if (userMsg) {
          await this.suggestedRepo.save(
            this.suggestedRepo.create({
              datasourceId: conversation.datasourceId,
              questionText: userMsg.content,
              source: 'learned',
              learnedSql: message.sqlText || undefined,
              priority: dto.templatePriority || 10,
              createdBy: uid,
            }),
          );
          savedAsTemplate = true;
          this.logger.log(
            `Saved learned template for datasource ${conversation.datasourceId}: "${userMsg.content.substring(0, 50)}..."`,
          );
        }
      }
    }

    // 3) 写入 feedback
    const fb = this.feedbackRepo.create({
      messageId,
      userId: uid,
      type: dto.type,
      notes: dto.notes,
      savedAsTemplate,
    });
    return this.feedbackRepo.save(fb);
  }

  async getByMessage(messageId: string): Promise<MessageFeedback[]> {
    return this.feedbackRepo.find({
      where: { messageId },
      order: { createdAt: 'DESC' },
    });
  }

  /** 管理后台：列出所有 bad 反馈（待工程师审查的"错答"清单）*/
  async listBadFeedback(limit = 100): Promise<MessageFeedback[]> {
    return this.feedbackRepo.find({
      where: { type: FeedbackType.BAD },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
