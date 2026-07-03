import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import {
  Conversation,
  Datasource,
  Message,
  MessageRole,
  TurnArtifact,
} from '../../../database/entities';
import { ChatOrchestratorService } from '../../../core/orchestrator/chat-orchestrator.service';
import { TurnRuntimeService } from '../../../core/orchestrator/turn-runtime.service';
import { ProjectService } from '../../project/services/project.service';
import { DatasetService } from '../../dataset/services/dataset.service';
import { ProjectSkillAssemblerService } from '../../dataset/services/project-skill-assembler.service';
import { ProfileRefinerService } from '../../user-profile/services/profile-refiner.service';
import { ChatAttachmentService } from '../../chat-attachments/services/chat-attachment.service';
import { SendMessageDto, CreateConversationDto } from '../dto/send-message.dto';
import { PlannerOutput } from '../../../core/agents/planner.agent';
import { MasterOutput } from '../../../core/agents/master-planner.agent';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(TurnArtifact)
    private readonly artifactRepo: Repository<TurnArtifact>,
    @InjectRepository(Datasource)
    private readonly datasourceRepo: Repository<Datasource>,
    private readonly orchestrator: ChatOrchestratorService,
    private readonly projectService: ProjectService,
    private readonly turnRuntime: TurnRuntimeService,
    private readonly datasetService: DatasetService,
    private readonly projectSkillAssembler: ProjectSkillAssemblerService,
    private readonly profileRefiner: ProfileRefinerService,
    private readonly chatAttachmentService: ChatAttachmentService,
  ) {}

  // ========== SSE 路径用 ==========

  /**
   * SSE 路径前置准备：创建/复用 conversation + 保存 user message + 算 effectiveQuestion。
   * 返回的信息会喂给 TurnRuntimeService.createTurn 启动 generator。
   */
  async prepareTurnForStream(
    dto: SendMessageDto,
    userId: string,
  ): Promise<{
    conversationId: string;
    userMessageId: string;
    userQuestion: string;
    effectiveQuestion: string;
    mode: 'single_skill' | 'master';
    /** 用户上传 dataset 模式：白名单注入 ToolContext */
    overrideAllowedTables?: string[];
    /** dataset 业务描述拼接，注入 Planner system prompt */
    datasetContext?: string;
    /** 当前 turn 图片附件 —— 走 Anthropic vision content block */
    currentAttachments?: import('../../../providers/llm/types').ChatAttachmentInline[];
  }> {
    // 数据源归属校验
    if (dto.datasourceId) {
      const ds = await this.datasourceRepo.findOne({ where: { id: dto.datasourceId } });
      if (!ds) throw new NotFoundException('数据源不存在');
      if (ds.ownerId && ds.ownerId !== userId) {
        throw new ForbiddenException('无权访问该数据源');
      }
    }

    // 准备对话
    let conversation: Conversation;
    if (dto.conversationId) {
      const found = await this.conversationRepo.findOne({ where: { id: dto.conversationId } });
      if (!found) throw new NotFoundException('Conversation not found');
      await this.assertCanAccessConversation(found, userId);
      conversation = found;
    } else {
      if (dto.projectId) {
        const canAccess = await this.projectService.canAccess(dto.projectId, userId);
        if (!canAccess) throw new ForbiddenException('无权在该 Project 下创建对话');
      }
      conversation = await this.conversationRepo.save(
        this.conversationRepo.create({
          userId,
          datasourceId: dto.datasourceId,
          projectId: dto.projectId || null,
          title: dto.message.substring(0, 50),
          mode: dto.mode === 'master' ? 'master' : 'single_skill',
        }),
      );
    }

    // 校验附件归属 + 拉 preview（后面拼进 planner context）
    let attachmentContext: string | undefined;
    let currentAttachments:
      | import('../../../providers/llm/types').ChatAttachmentInline[]
      | undefined;
    if (dto.attachmentIds && dto.attachmentIds.length > 0) {
      const atts = await this.chatAttachmentService.findAccessible(dto.attachmentIds, userId);
      attachmentContext = this.buildAttachmentContext(atts);
      currentAttachments = await this.buildInlineAttachments(atts);
    }

    // 保存 user message（带 attachments 引用）
    const userMessage = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        role: MessageRole.USER,
        content: dto.message,
        attachments: dto.attachmentIds && dto.attachmentIds.length > 0 ? dto.attachmentIds : undefined,
      }),
    );
    // 绑定 attachments.messageId
    if (dto.attachmentIds && dto.attachmentIds.length > 0) {
      await this.chatAttachmentService.attachToMessage(dto.attachmentIds, userMessage.id, userId);
    }

    // 用户自助分析模式：projectId + datasetIds → 走 ProjectSkill 装配器
    //   - 完全不引用企业 Skill 库（隔离 Skill 概念污染）
    //   - Master 模式禁用（dataset chat 没有 sub-skill 编排意义）
    //   - 白名单严格 = 选中的 dataset 表
    let overrideAllowedTables: string[] | undefined;
    let datasetContext: string | undefined;
    let forceSingleSkill = false;

    // 企业模式「分析范围」— 用户预先选表，作为 Planner 白名单缩小搜索
    // 不 override datasetContext（企业模式仍走 Skill 库）
    if (
      (!dto.datasetIds || dto.datasetIds.length === 0) &&
      dto.analyzedTables &&
      dto.analyzedTables.length > 0
    ) {
      overrideAllowedTables = dto.analyzedTables;
      const mentions = this.extractFieldMentions(dto.message);
      const scopeHint = [
        '# 📎 用户预选的分析范围',
        `用户在 chat 前明示要分析这些表：${dto.analyzedTables.map((t) => `\`${t}\``).join(', ')}`,
        '',
        '**跳过 `list_tables` / `search_tables` 探索** — 直接用这些表写 SQL。',
        '你仍可 `describe_table` 确认字段（若不确定），但不要发散到其他表。',
      ];
      if (mentions.length > 0) {
        scopeHint.push('', '## 👁 用户特别提及的字段（@）');
        mentions.forEach((f) => scopeHint.push(`- \`${f}\``));
        scopeHint.push('**围绕这些字段展开分析**。');
      }
      datasetContext = scopeHint.join('\n');
    }

    if (dto.datasetIds && dto.datasetIds.length > 0) {
      if (!dto.projectId) {
        throw new ForbiddenException(
          '使用 dataset 模式必须指定 projectId（Personal Workspace 也是一个 project）',
        );
      }
      // 校验 user 对 project 有访问权
      const canAccessProject = await this.projectService.canAccess(dto.projectId, userId);
      if (!canAccessProject) {
        throw new ForbiddenException('你无权访问该项目');
      }
      const skill = await this.projectSkillAssembler.assemble(
        dto.projectId,
        dto.datasetIds,
      );
      overrideAllowedTables = skill.allowedTables;
      datasetContext = skill.systemPrompt;
      forceSingleSkill = true;

      // 识别 message 里的 @字段 mentions（前端 Mentions 组件插入的 @col_name）
      // 追加到 datasetContext 作为强提示，让 LLM 围绕这些字段分析
      const mentions = this.extractFieldMentions(dto.message);
      if (mentions.length > 0) {
        const validFields = mentions.filter((m) =>
          skill.selectedDatasets.some((ds) =>
            (ds as any).columns?.some?.((c: any) => c.name === m),
          ) ||
          // ProjectSkillAssembler 未暴露完整 columns → 保底：只要出现就当作有效
          true,
        );
        if (validFields.length > 0) {
          datasetContext +=
            '\n\n## 👁 用户特别提及的字段（@）\n' +
            validFields.map((f) => `- \`${f}\``).join('\n') +
            '\n\n**请围绕这些字段展开分析**（作为聚合维度 / 过滤依据 / 主指标）。' +
            '如数据明显不适合围绕它们，可以给出更好选择，但需说明为什么。';
        }
      }
    }

    // 附件上下文 —— 拼进 datasetContext 前面（让 Planner 优先看到用户当前 turn 上传了啥）
    if (attachmentContext) {
      datasetContext = attachmentContext + (datasetContext ? '\n\n---\n\n' + datasetContext : '');
    }

    return {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      userQuestion: dto.message,
      effectiveQuestion: dto.message,
      mode: forceSingleSkill
        ? 'single_skill'
        : conversation.mode === 'master'
          ? 'master'
          : 'single_skill',
      overrideAllowedTables,
      datasetContext,
      currentAttachments,
    };
  }

  /**
   * 把附件转成 provider-ready 的 inline 形式
   *
   * image → 读文件 + base64 → vision content block
   * table/pdf/text → preview 已经拼进 datasetContext（不重复占 tokens）
   */
  private async buildInlineAttachments(
    atts: import('../../../database/entities').ChatAttachment[],
  ): Promise<import('../../../providers/llm/types').ChatAttachmentInline[]> {
    const out: import('../../../providers/llm/types').ChatAttachmentInline[] = [];
    for (const a of atts) {
      if (a.kind === 'image') {
        try {
          const buf = await this.chatAttachmentService.readFileBuffer(a);
          out.push({
            filename: a.filename,
            kind: 'image',
            imageBase64: buf.toString('base64'),
            imageMime: a.mimeType,
          });
        } catch (err) {
          this.logger.warn(
            `Failed to read image attachment ${a.id}: ${(err as Error).message}`,
          );
        }
      }
      // 其他 kind 走 datasetContext 文本注入，不再重复
    }
    return out;
  }

  /**
   * 把用户本轮上传的附件 preview 拼成 planner system 前置块
   *
   * 关键：告诉 Planner "这些是本轮附件，不是数据库表" —— 避免它试图 SELECT * FROM 用户上传的文件
   * 每种 kind 给出不同的处理建议
   */
  private buildAttachmentContext(atts: import('../../../database/entities').ChatAttachment[]): string {
    if (atts.length === 0) return '';
    const lines: string[] = [];
    lines.push('# 📎 本轮用户上传的附件');
    lines.push('');
    lines.push('用户在这次对话里粘贴/上传了以下文件。**这些不是数据库表**，是本次消息的附加上下文。');
    lines.push('');
    for (const a of atts) {
      lines.push(`## 「${a.filename}」（${a.kind}）`);
      const preview = a.preview || {};
      switch (a.kind) {
        case 'image':
          lines.push(`- 图片 (${a.mimeType})，Anthropic vision block 已内嵌到 user 消息里`);
          lines.push(`- **直接根据图像内容回答**，不要试图查库理解它`);
          break;
        case 'table': {
          const cols = (preview.columns as any[]) || [];
          const rows = (preview.sampleRows as any[]) || [];
          lines.push(`- 表格：${preview.rowCount || rows.length} 行、${cols.length} 列`);
          lines.push(`- 列：${cols.map((c) => `\`${c.name}\`(${c.type})`).join(', ')}`);
          if (rows.length > 0) {
            lines.push(`- 前 ${Math.min(5, rows.length)} 行样本：`);
            lines.push('  ```json');
            lines.push('  ' + JSON.stringify(rows.slice(0, 5), null, 2).split('\n').join('\n  '));
            lines.push('  ```');
          }
          lines.push('- **处理建议**：');
          lines.push('  - 如果附件数据能独立回答问题（小表 <1000 行）→ 直接基于附件分析');
          lines.push('  - 如果需要跟企业数据库交叉（例：附件里的客户 ID 在库里查发货）→ 用附件里的值作 WHERE');
          lines.push('  - 不要尝试 `SELECT * FROM 附件` —— 附件在 context 里，不是 SQL 可查表');
          break;
        }
        case 'pdf':
        case 'text':
          lines.push(`- 文本内容 (${preview.pageCount ? preview.pageCount + ' 页' : preview.lineCount + ' 行'})：`);
          lines.push('  ```');
          lines.push('  ' + String(preview.textPreview || '').split('\n').join('\n  '));
          lines.push('  ```');
          if (preview.totalTextLength > 3000) {
            lines.push(`- 仅前 3000 字（总长 ${preview.totalTextLength}）`);
          }
          break;
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * SSE 路径后置：在 background 等 generator drain 完成 → composeResultFromPlan
   * → 保存 assistant message + turn artifact + skill lock + 释放 turn state。
   *
   * 不阻塞 controller — fire and forget。
   */
  finalizeStreamingTurnInBackground(
    turnId: string,
    prep: {
      conversationId: string;
      userMessageId: string;
      userQuestion: string;
      effectiveQuestion: string;
      mode: 'single_skill' | 'master';
    },
  ): void {
    void this.doFinalizeStreamingTurn(turnId, prep).catch((err) =>
      this.logger.error(
        `Failed to finalize streaming turn ${turnId}: ${(err as Error).message}`,
      ),
    );
  }

  private async doFinalizeStreamingTurn(
    turnId: string,
    prep: {
      conversationId: string;
      userMessageId: string;
      userQuestion: string;
      effectiveQuestion: string;
      mode: 'single_skill' | 'master';
    },
  ): Promise<void> {
    const planOutput = await this.turnRuntime.awaitDone(turnId);
    if (!planOutput) {
      this.logger.warn(`Streaming turn ${turnId} finished with no output (errored or expired)`);
      this.turnRuntime.releaseTurn(turnId);
      return;
    }

    const conversation = await this.conversationRepo.findOne({
      where: { id: prep.conversationId },
    });
    if (!conversation) {
      this.turnRuntime.releaseTurn(turnId);
      return;
    }

    // 把 generator 终态喂回 orchestrator 的 plan→result 流水线
    // PlannerOutput 和 MasterOutput 都满足 PlannerLikeOutput 形状（duck-typed）
    const plan = this.normalizePlannerLikeOutput(planOutput, prep.mode);
    const result = await this.orchestrator.composeResultFromPlan(plan, {
      question: prep.effectiveQuestion,
      datasourceId: conversation.datasourceId!,
      conversationId: conversation.id,
    });

    // 保存 assistant message
    const assistantPayload: DeepPartial<Message> = {
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      content: result.narrative,
      sqlText: result.sql,
      chartConfig: result.chart as any,
      resultData: {
        columns: result.data.columns,
        rowCount: result.resultSummary.rowCount,
        sampleRows: result.data.rows.slice(0, 100),
      } as any,
      metadata: {
        confidence: result.confidence,
        refused: result.refused,
        refuseReason: result.refuseReason,
        executionTimeMs: result.resultSummary.executionTimeMs,
        fromCache: result.resultSummary.fromCache,
        provenance: result.provenance,
        skillName: result.skillName,
        insights: result.insights,
        suggestedFollowUps: result.suggestedFollowUps,
        relatedHints: result.relatedHints,
        lineage: result.lineage,
        columnDisplayMap: result.columnDisplayMap,
        clarify: result.clarify,
        sseStreamed: true,
        sseStreamTurnId: turnId,
      } as any,
    };
    const assistantMessage = await this.messageRepo.save(
      this.messageRepo.create(assistantPayload),
    );

    // 持久化 turn artifact
    try {
      const turnIndex = await this.computeNextTurnIndex(conversation.id);
      await this.artifactRepo.save(
        this.artifactRepo.create({
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          turnIndex,
          userQuestion: prep.userQuestion,
          assistantNarrative: result.narrative,
          refused: result.refused,
          rawMessages: result.rawMessages,
          resultColumns: result.data.columns,
          resultRows: result.data.rows,
          resultRowCount: result.resultSummary.rowCount,
          finalSql: result.sql || null,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to persist turn artifact: ${(err as Error).message}`);
    }

    // 锁定 Skill
    if (!conversation.lockedSkillName && result.skillName && !result.refused) {
      try {
        conversation.lockedSkillName = result.skillName;
        await this.conversationRepo.save(conversation);
      } catch (err) {
        this.logger.warn(`Failed to lock skill: ${(err as Error).message}`);
      }
    }

    this.turnRuntime.releaseTurn(turnId);

    // 每 N 个对话后异步刷新 user profile（fire-and-forget，不阻塞主流程）
    if (conversation.userId) {
      this.profileRefiner.refineIfDueAsync(conversation.userId);
    }
  }

  /** PlannerOutput | MasterOutput → orchestrator 用的 PlannerLikeOutput 形状 */
  /**
   * 从用户 message 里挖 @field 提及（前端 Mentions 组件插入）。
   * 支持 snake_case / camelCase / 数字下划线 — 遵循 PG 列名合法字符。
   */
  private extractFieldMentions(message: string): string[] {
    if (!message.includes('@')) return [];
    const matches = message.match(/@([a-z_][a-z0-9_]*)/gi) || [];
    return Array.from(new Set(matches.map((m) => m.substring(1)))).slice(0, 10);
  }

  private normalizePlannerLikeOutput(
    out: PlannerOutput | MasterOutput,
    mode: 'single_skill' | 'master',
  ): any {
    if (mode === 'single_skill') {
      const p = out as PlannerOutput;
      return {
        finalize: p.finalize,
        trace: p.trace,
        totalTokens: p.totalTokens,
        totalLatencyMs: p.totalLatencyMs,
        sqlResult: p.sqlResult,
        skill: p.skill,
        rawMessages: p.rawMessages,
      };
    }
    // Master 模式：构造一个最小 skill 占位
    const m = out as MasterOutput;
    return {
      finalize: m.finalize,
      trace: m.trace as any,
      totalTokens: m.totalTokens,
      totalLatencyMs: m.totalLatencyMs,
      sqlResult: m.sqlResult,
      skill: {
        meta: { name: m.skillName, version: '1.0.0', description: 'master mode' },
        body: '',
      } as any,
      rawMessages: m.rawMessages,
    };
  }

  // buildMergedClarifyQuestion() 已删 — SSE 路径下 clarify 走 generator 内置 yield/resume

  /** 校验用户对一个 conversation 是否有访问权（owner 或 project member） */
  private async assertCanAccessConversation(conv: Conversation, userId: string) {
    if (conv.userId === userId) return;
    if (conv.projectId) {
      const canAccess = await this.projectService.canAccess(conv.projectId, userId);
      if (canAccess) return;
    }
    throw new ForbiddenException('无权访问该对话');
  }

  // sendMessage() 已删 — 唯一通路是 SSE：见 ChatStreamController + prepareTurnForStream + finalizeStreamingTurnInBackground

  /** 计算下一轮的 turn_index */
  private async computeNextTurnIndex(conversationId: string): Promise<number> {
    const last = await this.artifactRepo.findOne({
      where: { conversationId },
      order: { turnIndex: 'DESC' },
    });
    return (last?.turnIndex || 0) + 1;
  }

  /** 创建空对话 */
  async createConversation(dto: CreateConversationDto, userId: string): Promise<Conversation> {
    if (dto.datasourceId) {
      const ds = await this.datasourceRepo.findOne({ where: { id: dto.datasourceId } });
      if (!ds) throw new NotFoundException('数据源不存在');
      if (ds.ownerId && ds.ownerId !== userId) {
        throw new ForbiddenException('无权访问该数据源');
      }
    }
    if (dto.projectId) {
      const canAccess = await this.projectService.canAccess(dto.projectId, userId);
      if (!canAccess) throw new ForbiddenException('无权在该 Project 下创建对话');
    }
    return this.conversationRepo.save(
      this.conversationRepo.create({
        userId,
        datasourceId: dto.datasourceId,
        projectId: dto.projectId || null,
        title: dto.title,
      }),
    );
  }

  /**
   * 列出对话：自己的 + 自己参与的 Project 下的所有对话
   * 可选按 projectId 过滤
   */
  async listConversations(
    userId: string,
    options: { projectId?: string; limit?: number } = {},
  ): Promise<Conversation[]> {
    const { projectId, limit = 50 } = options;
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .orderBy('c.updated_at', 'DESC')
      .limit(limit);

    if (projectId) {
      // 显式按 project 过滤：只看该 project 下，且我有 project 访问权
      const canAccess = await this.projectService.canAccess(projectId, userId);
      if (!canAccess) throw new ForbiddenException('无权访问该 Project');
      qb.where('c.project_id = :pid', { pid: projectId });
    } else {
      // 默认：自己的对话 OR 自己参与的 project 下的对话
      qb.where('c.user_id = :uid', { uid: userId }).orWhere(
        'c.project_id IN (SELECT project_id FROM app.project_members WHERE user_id = :uid) ' +
          'OR c.project_id IN (SELECT id FROM app.projects WHERE owner_id = :uid)',
        { uid: userId },
      );
    }
    return qb.getMany();
  }

  /** 获取对话历史（自己的 / 同 project 成员都可访问） */
  async getHistory(conversationId: string, userId: string): Promise<{
    conversation: Conversation;
    messages: Message[];
  }> {
    const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    await this.assertCanAccessConversation(conversation, userId);
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
    return { conversation, messages };
  }

  /**
   * 更新对话（移到项目 / 移出项目 / 改标题）
   *
   * 权限：自己创建的对话 OR 当前 project 的成员（任意角色）
   * 移到新项目时：必须有目标 project 的访问权
   */
  async updateConversation(
    conversationId: string,
    userId: string,
    dto: { projectId?: string | null; title?: string },
  ): Promise<Conversation> {
    const conv = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    await this.assertCanAccessConversation(conv, userId);

    if (dto.projectId !== undefined) {
      if (dto.projectId === null) {
        conv.projectId = null;
      } else {
        const canAccess = await this.projectService.canAccess(dto.projectId, userId);
        if (!canAccess) throw new ForbiddenException('无权将对话移到该 Project');
        conv.projectId = dto.projectId;
      }
    }
    if (dto.title !== undefined && dto.title.trim()) {
      conv.title = dto.title.trim().substring(0, 255);
    }
    return this.conversationRepo.save(conv);
  }

  /** 删除对话：只有 owner（user_id）或 project admin/owner 能删 */
  async deleteConversation(conversationId: string, userId: string): Promise<void> {
    const conv = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    if (conv.userId === userId) {
      await this.conversationRepo.delete({ id: conversationId });
      return;
    }
    if (conv.projectId) {
      const role = await this.projectService.getRole(conv.projectId, userId);
      if (role === 'owner' || role === 'admin') {
        await this.conversationRepo.delete({ id: conversationId });
        return;
      }
    }
    throw new ForbiddenException('无权删除该对话');
  }
}
