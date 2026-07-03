import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TurnArtifact } from '../../../database/entities';

export interface TurnSummary {
  turnIndex: number;
  question: string;
  finalSql: string | null;
  rowCount: number | null;
  /** narrative 截取前 200 字符做预览 */
  narrativeSnippet: string;
  refused: boolean;
}

/**
 * 历史轮次召回服务
 *
 * 给 Planner 和 recall tools 提供按 conversationId / turnIndex 拉取真实历史的能力
 * - 不做摘要、不做压缩、只忠实回放
 * - 对 raw_messages（含 tool calls 和 results）做 token-friendly 的轻量整理
 */
@Injectable()
export class TurnRecallService {
  private readonly logger = new Logger(TurnRecallService.name);

  constructor(
    @InjectRepository(TurnArtifact)
    private readonly artifactRepo: Repository<TurnArtifact>,
  ) {}

  /**
   * 列出对话所有轮次的概要（不含完整数据）
   * 用于 list_previous_turns 工具
   */
  async listTurns(conversationId: string): Promise<TurnSummary[]> {
    const artifacts = await this.artifactRepo.find({
      where: { conversationId },
      order: { turnIndex: 'ASC' },
    });
    return artifacts.map((a) => {
      const narrative = a.assistantNarrative || '';
      return {
        turnIndex: a.turnIndex,
        question: a.userQuestion,
        finalSql: a.finalSql,
        rowCount: a.resultRowCount,
        narrativeSnippet:
          narrative.length > 200 ? narrative.substring(0, 200) + '...' : narrative,
        refused: a.refused,
      };
    });
  }

  /**
   * 拉取某轮的结果数据
   * 用于 recall_turn_result 工具
   */
  async getResultRows(
    conversationId: string,
    turnIndex: number,
    limit = 50,
  ): Promise<{
    turnIndex: number;
    finalSql: string | null;
    columns: { name: string; type: string }[];
    rows: Record<string, any>[];
    totalRowCount: number;
    truncated: boolean;
  } | null> {
    const artifact = await this.artifactRepo.findOne({
      where: { conversationId, turnIndex },
    });
    if (!artifact) return null;
    const all = artifact.resultRows || [];
    const rows = all.slice(0, limit);
    return {
      turnIndex: artifact.turnIndex,
      finalSql: artifact.finalSql,
      columns: artifact.resultColumns || [],
      rows,
      totalRowCount: artifact.resultRowCount || all.length,
      truncated: all.length > limit,
    };
  }

  /**
   * 拉取某轮完整 ConversationMessage[]
   * 用于 recall_turn_messages 工具 / Planner 全量 replay
   */
  async getRawMessages(
    conversationId: string,
    turnIndex: number,
  ): Promise<any[] | null> {
    const artifact = await this.artifactRepo.findOne({
      where: { conversationId, turnIndex },
    });
    return artifact?.rawMessages || null;
  }

  /**
   * 拉取最近 N 轮的完整 artifact，PlannerAgent 在构造 messages 时用
   */
  async getRecentArtifacts(
    conversationId: string,
    limit: number,
  ): Promise<TurnArtifact[]> {
    return this.artifactRepo.find({
      where: { conversationId },
      order: { turnIndex: 'DESC' },
      take: limit,
    });
  }

}
