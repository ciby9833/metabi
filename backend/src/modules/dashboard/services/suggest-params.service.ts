import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../../../providers/llm/llm-gateway.service';
import { LLMScenario } from '../../../providers/llm/types';
import type { Widget } from '../../../database/entities';

export interface ParamSuggestion {
  suggestedSql: string;
  suggestedParams: NonNullable<Widget['params']>;
  changes: Array<{ from: string; toPlaceholder: string; reason: string }>;
}

/**
 * 智能参数化 — 让 LLM 从"硬编码"的 SQL 里识别可调参数
 *
 * AI 生成 SQL 通常直接写死 `date >= '2026-05-24'`，这里用 LLM 把这类字面量
 * 换成 `{{startDate}}` 占位符，并给出 params 定义。
 *
 * 关键约束（喂给 LLM）：
 *   1) 只参数化 WHERE / HAVING 里的字面量；SELECT/GROUP BY 的字段名/别名/常量不动
 *   2) 只挑"用户可能想调"的：日期、时间点、明显的枚举值（IN/= 一个字符串）、阈值数字
 *   3) 聚合函数里的常量（COUNT(1)、AVG(0)）不动
 *   4) LIMIT/OFFSET 不动
 *   5) 保守 —— 不确定就不参数化
 */
@Injectable()
export class SuggestParamsService {
  private readonly logger = new Logger(SuggestParamsService.name);

  constructor(private readonly llm: LLMGatewayService) {}

  async suggest(sql: string, existingParams: Widget['params']): Promise<ParamSuggestion> {
    if (!sql?.trim()) throw new BadRequestException('SQL 为空');

    // 已定义的 keys 交给 LLM 复用（不要重新命名冲突）
    const knownKeys = (existingParams || []).map((p) => p.key);

    const response = await this.llm.call(
      [
        {
          role: 'system',
          content:
            '你是 SQL 参数化助手。任务：把 SQL 里 WHERE/HAVING 中"硬编码的字面量"识别出来，替换为 {{key}} 占位符，并生成参数定义。' +
            '硬约束：\n' +
            '1) 只改 WHERE / HAVING 里的字面量；SELECT、FROM、JOIN ON、GROUP BY、ORDER BY、LIMIT、聚合函数常量都不动\n' +
            '2) 只提取"业务上用户会想调整"的：日期字面量、时间字符串、明显的枚举值（= 或 IN 单一/少数字符串）、明显的阈值数字\n' +
            "3) 单引号字符串常量 → 类型判断：'YYYY-MM-DD' → date；其他单值字符串 → text；IN (...) 且元素≤10 → enum + options\n" +
            '4) 裸数字 → number；日期区间（同字段 >= X AND <= Y）→ 拆两个 date 占位符（不用 daterange 类型，保持 SQL 直观）\n' +
            '5) key 用驼峰命名，短且贴近业务，例：startDate / endDate / region / minAmount\n' +
            '6) label 用中文，2-6 字\n' +
            '7) default 值就是原字面量本身（保证不改行为）\n' +
            '8) 保守：任何不确定的字面量都不动 —— 宁可少参数化也别乱改\n' +
            '9) 输出必须是纯 JSON（不要 markdown 包裹），schema 见 <output_schema>',
        },
        {
          role: 'user',
          content: this.buildPrompt(sql, knownKeys),
        },
      ],
      { scenario: LLMScenario.SQL_GENERATION, temperature: 0.1 },
    );

    const raw = response.content?.trim() || '';
    const parsed = this.parseResponse(raw, sql);

    // 校验：改写后的 SQL 必须包含所有新占位符，且不能引入未定义的
    const placeholders = this.extractPlaceholders(parsed.suggestedSql);
    const paramKeys = new Set(parsed.suggestedParams.map((p) => p.key));
    const orphan = placeholders.filter((k) => !paramKeys.has(k));
    if (orphan.length > 0) {
      this.logger.warn(`LLM produced orphan placeholders: ${orphan.join(',')}. Falling back.`);
      // 兜底：拒绝这次建议，返回原 SQL 和空 params，让前端提示"没识别到可参数化项"
      return {
        suggestedSql: sql,
        suggestedParams: existingParams || [],
        changes: [],
      };
    }

    return parsed;
  }

  private buildPrompt(sql: string, knownKeys: string[]): string {
    return `<sql>
${sql}
</sql>

${knownKeys.length > 0 ? `<already_defined_keys>${knownKeys.join(', ')}</already_defined_keys>\n（这些已有 param 名，如果它们在原 SQL 里就已经是占位符 {{key}} 请保留；命名新占位符时避免与它们冲突）\n` : ''}

<output_schema>
{
  "suggestedSql": "改写后的 SQL（把字面量换成 {{key}}）",
  "suggestedParams": [
    { "key": "startDate", "label": "开始日期", "type": "date", "default": "2026-05-24" }
  ],
  "changes": [
    { "from": "'2026-05-24'", "toPlaceholder": "{{startDate}}", "reason": "WHERE 里的日期字面量，用户会想调时间范围" }
  ]
}
</output_schema>

要求：
- suggestedSql 是完整可执行的 SQL，只是把字面量位置换成 {{...}}
- suggestedParams 里每个 key 都必须在 suggestedSql 里出现（形式 {{key}}）
- suggestedParams 里 type 取值范围：date / number / text / enum
- enum 必须给 options（原 SQL 里 IN 的完整候选列表）
- changes 数组解释你替换了哪些字面量、为什么
- 如果 SQL 里没有可参数化的东西，返回 { "suggestedSql": <原 sql 一字不改>, "suggestedParams": [], "changes": [] }
- 只输出 JSON，无任何前后缀`;
  }

  private parseResponse(raw: string, originalSql: string): ParamSuggestion {
    let body = raw;
    if (body.startsWith('```')) {
      body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    try {
      const j = JSON.parse(body);
      const suggestedSql = String(j.suggestedSql || originalSql);
      const rawParams: any[] = Array.isArray(j.suggestedParams) ? j.suggestedParams : [];
      const suggestedParams = rawParams
        .filter((p) => p && typeof p.key === 'string' && p.key.trim())
        .map((p) => ({
          key: String(p.key).trim(),
          label: String(p.label || p.key).trim(),
          type: this.normalizeType(p.type),
          default: p.default,
          options: Array.isArray(p.options) ? p.options.map(String) : undefined,
        }));
      const changes = Array.isArray(j.changes)
        ? j.changes.map((c: any) => ({
            from: String(c?.from || ''),
            toPlaceholder: String(c?.toPlaceholder || ''),
            reason: String(c?.reason || ''),
          }))
        : [];
      return { suggestedSql, suggestedParams, changes };
    } catch (err) {
      this.logger.warn(
        `Failed to parse suggest-params JSON: ${(err as Error).message}. Raw=${raw.substring(0, 200)}`,
      );
      return { suggestedSql: originalSql, suggestedParams: [], changes: [] };
    }
  }

  private normalizeType(t: any): 'date' | 'number' | 'text' | 'enum' {
    const s = String(t || '').toLowerCase();
    if (s === 'date' || s === 'number' || s === 'enum' || s === 'text') return s;
    return 'text';
  }

  private extractPlaceholders(sql: string): string[] {
    const matches = sql.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) || [];
    return [...new Set(matches.map((m) => m.slice(2, -2)))];
  }
}
