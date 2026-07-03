import { Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../../providers/llm/llm-gateway.service';
import { LLMScenario } from '../../providers/llm/types';
import { QueryResult } from '../../providers/connector/types';
import { NARRATOR_SYSTEM_PROMPT, buildNarratorUserPrompt } from '../prompts/narrator.prompt';

/**
 * Narrator
 * 把查询结果总结为自然语言播报，用于飞书推送 / 对话回复。
 */
@Injectable()
export class NarratorAgent {
  private readonly logger = new Logger(NarratorAgent.name);
  private readonly maxPreviewRows = 20;

  constructor(private readonly llmGateway: LLMGatewayService) {}

  async narrate(question: string, sql: string, result: QueryResult): Promise<string> {
    if (result.rowCount === 0) {
      return '本次查询未返回任何数据。请检查筛选条件或时间范围是否合理。';
    }

    const preview = this.formatResultPreview(result);
    const userPrompt = buildNarratorUserPrompt(question, sql, preview);

    try {
      const response = await this.llmGateway.call(
        [
          { role: 'system', content: NARRATOR_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { scenario: LLMScenario.NARRATIVE, temperature: 0.4 },
      );
      return response.content.trim();
    } catch (err) {
      this.logger.warn(`Narrator LLM call failed: ${(err as Error).message}; falling back to simple summary`);
      return this.fallbackSummary(result);
    }
  }

  private formatResultPreview(result: QueryResult): string {
    const headers = result.columns.map((c) => c.name).join(' | ');
    const previewRows = result.rows.slice(0, this.maxPreviewRows).map((row) =>
      result.columns
        .map((c) => {
          const v = row[c.name];
          return v === null || v === undefined ? '' : String(v);
        })
        .join(' | '),
    );
    const lines = [`总行数：${result.rowCount}`, '', headers, '-'.repeat(headers.length), ...previewRows];
    if (result.rowCount > this.maxPreviewRows) {
      lines.push(`...（仅展示前 ${this.maxPreviewRows} 行）`);
    }
    return lines.join('\n');
  }

  private fallbackSummary(result: QueryResult): string {
    return `共返回 ${result.rowCount} 行结果，包含 ${result.columns.length} 个字段（${result.columns
      .map((c) => c.name)
      .slice(0, 5)
      .join('、')}）。`;
  }
}
