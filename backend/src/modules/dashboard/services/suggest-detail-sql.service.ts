import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LLMGatewayService } from '../../../providers/llm/llm-gateway.service';
import { LLMScenario } from '../../../providers/llm/types';

export interface DetailSqlSuggestion {
  detailSql: string;
  isAlreadyDetail: boolean;
  changes: string[];
}

/**
 * 从"图表 SQL"生成"明细 SQL"
 *
 * Widget 里的 SQL 通常是聚合 + top N（GROUP BY / ORDER BY / LIMIT）—— 用户下载它拿到的只是
 * 图表展示的那几行汇总。想拿"背后每一单"的明细，需要把聚合层脱掉。
 *
 * 让 LLM 做这个转换：
 *   1) 脱掉 GROUP BY / HAVING / ORDER BY / LIMIT / OFFSET
 *   2) SELECT 里的聚合函数 → 换成 * 或维度字段
 *   3) 保留 FROM / JOIN / WHERE / {{占位符}}
 *
 * 兜底：如果原 SQL 已经是明细（没有聚合），isAlreadyDetail=true 原样返回
 */
@Injectable()
export class SuggestDetailSqlService {
  private readonly logger = new Logger(SuggestDetailSqlService.name);

  constructor(private readonly llm: LLMGatewayService) {}

  async suggest(sql: string): Promise<DetailSqlSuggestion> {
    if (!sql?.trim()) throw new BadRequestException('SQL 为空');

    const response = await this.llm.call(
      [
        {
          role: 'system',
          content:
            '你是 SQL 分析助手。任务：把用户的"聚合 SQL"转换成"底表明细 SQL"。' +
            '硬约束：\n' +
            '1) 脱掉外层的 GROUP BY / HAVING / ORDER BY / LIMIT / OFFSET\n' +
            '2) SELECT 里的聚合函数（COUNT/SUM/AVG/MIN/MAX/COUNT DISTINCT/STRING_AGG/ARRAY_AGG）删除；用 * 或 FROM 里表的实际业务列取代\n' +
            '3) 保留 FROM / JOIN / WHERE 完整不动\n' +
            '4) 保留 {{占位符}} 不动\n' +
            '5) 如果 SQL 已经是明细（无 GROUP BY 且 SELECT 无聚合函数），isAlreadyDetail=true 并原样返回\n' +
            '6) 输出必须是纯 JSON（不要 markdown 包裹）\n' +
            '7) 保持转换的保守性 —— 有疑问就用 SELECT *',
        },
        {
          role: 'user',
          content: `<original_sql>
${sql}
</original_sql>

<output_schema>
{
  "detailSql": "转换后的明细 SQL",
  "isAlreadyDetail": false,
  "changes": ["脱掉 GROUP BY xxx", "SELECT COUNT(*) 改为 SELECT *", "..."]
}
</output_schema>

只输出 JSON。`,
        },
      ],
      { scenario: LLMScenario.SQL_GENERATION, temperature: 0.1 },
    );

    return this.parseResponse(response.content?.trim() || '', sql);
  }

  private parseResponse(raw: string, originalSql: string): DetailSqlSuggestion {
    let body = raw;
    if (body.startsWith('```')) {
      body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    try {
      const j = JSON.parse(body);
      return {
        detailSql: String(j.detailSql || originalSql),
        isAlreadyDetail: Boolean(j.isAlreadyDetail),
        changes: Array.isArray(j.changes) ? j.changes.map(String) : [],
      };
    } catch (err) {
      this.logger.warn(
        `Failed to parse detail-sql JSON: ${(err as Error).message}. Raw=${raw.substring(0, 200)}`,
      );
      // fallback：返回原 SQL 让用户手动处理
      return {
        detailSql: originalSql,
        isAlreadyDetail: false,
        changes: ['LLM 未能生成有效明细 SQL，使用原 SQL 兜底'],
      };
    }
  }
}
