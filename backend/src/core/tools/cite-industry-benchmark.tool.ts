import { Injectable, Logger } from '@nestjs/common';
import { AgentTool, ToolContext, ToolDefinition } from './tool.types';

interface Input {
  /**
   * 要查的指标 / 关键词（中文或英文均可），如：
   *   - "派件签收率"
   *   - "时效"
   *   - "客单价"
   * 工具会按关键词在当前 Skill 的 ## 行业基准 段落里模糊匹配。
   */
  metric: string;
}

interface BenchmarkHit {
  /** 命中的小节标题或描述 */
  title: string;
  /** 该小节正文（markdown）*/
  text: string;
}

interface Output {
  ok: boolean;
  skillName: string;
  /** 完整段落（如果 metric 留空也整段返回）*/
  fullSection?: string;
  /** 模糊匹配到的具体小节（若有）*/
  hits: BenchmarkHit[];
  /** 给 LLM 的引导文字，提示如何在 narrative 里标注"来源" */
  citationHint: string;
  /** 无段落时的提示 */
  notice?: string;
}

/**
 * 引用「行业基准」段落
 *
 * 设计原则：
 *   - 只读 Skill body 里 `## 行业基准` 这一节（人工维护，可审计）
 *   - 绝不让 LLM 拿训练知识胡编数字
 *   - 工具输出会强制标注"来源：手动维护的行业基准库"，避免被误解为系统计算出来的
 */
@Injectable()
export class CiteIndustryBenchmarkTool implements AgentTool<Input, Output> {
  private readonly logger = new Logger(CiteIndustryBenchmarkTool.name);

  readonly definition: ToolDefinition = {
    name: 'cite_industry_benchmark',
    description:
      '从当前 Skill 的「行业基准」段落抽取参考数据（如签收率、时效、客单价的行业平均/上限/下限）。\n' +
      '⚠️ 使用场景：用户问"行业一般什么水平/标杆/通常/对比/标准"等。\n' +
      '⚠️ 数据来源是 Skill body 里人工维护的 `## 行业基准` 段落，不会幻觉。\n' +
      '⚠️ 引用时必须在 narrative 里**明示**"来源：行业基准库（人工维护）"，不能伪装成系统计算出来的数据。\n' +
      '⚠️ 如果当前 Skill 没有「行业基准」段落，工具会返回 ok=false，此时**应**走拒答路径，引导用户在 Skills 后台补充基准。',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          description:
            '要查的指标关键词，如"派件签收率"、"时效"、"客单价"。可留空以拿全部基准段落。',
        },
      },
      required: ['metric'],
      additionalProperties: false,
    },
    // 企业 datasource 专用：基于业务 metric/SQL 模板的计算工具，不适合用户上传的小型 dataset
    availability: 'enterprise_only',
  };

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const skill = ctx.skill;
    if (!skill?.body) {
      return {
        ok: false,
        skillName: skill?.name || 'unknown',
        hits: [],
        citationHint: '',
        notice: '当前会话没有可用 Skill，无法引用行业基准。',
      };
    }

    const section = extractSection(skill.body, ['行业基准', 'industry benchmark', '行业标杆']);
    if (!section) {
      return {
        ok: false,
        skillName: skill.name,
        hits: [],
        citationHint: '',
        notice: `当前 Skill「${skill.name}」尚未维护「行业基准」段落。建议在 Skills 后台补充，否则只能基于内部数据回答。`,
      };
    }

    const metric = (input.metric || '').trim();
    const hits = metric ? fuzzyMatch(section, metric) : [];

    return {
      ok: true,
      skillName: skill.name,
      fullSection: section,
      hits,
      citationHint:
        '把这段基准与你查询出的真实数据**并排展示**。在 narrative 中明示「来源：行业基准库（人工维护）」，并清晰区分「你的数据」与「行业基准」。',
    };
  }
}

/** 从 markdown body 里抽出指定 H2 标题（## XXX）下的内容，到下一个 H2 之前 */
function extractSection(body: string, titleAliases: string[]): string | null {
  const lines = body.split(/\r?\n/);
  const aliasLower = titleAliases.map((s) => s.toLowerCase());

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m) {
      const headerLower = m[1].trim().toLowerCase();
      if (aliasLower.some((a) => headerLower.includes(a))) {
        startIdx = i + 1;
        break;
      }
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n').trim() || null;
}

/** 在段落里按子标题 (### / 加粗 / *列表项) 切片，按关键词模糊命中 */
function fuzzyMatch(section: string, metric: string): BenchmarkHit[] {
  const blocks: BenchmarkHit[] = [];
  const lines = section.split(/\r?\n/);

  // 优先把 ### XXX 当 block，否则按列表项切
  let currentTitle = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length) {
      blocks.push({
        title: currentTitle || '基准段落',
        text: currentLines.join('\n').trim(),
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      flush();
      currentTitle = h3[1];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  if (blocks.length === 0) {
    // 没有 ### 子标题就把整段视为一个 block
    blocks.push({ title: '基准段落', text: section });
  }

  const needle = metric.toLowerCase();
  return blocks.filter((b) =>
    (b.title + '\n' + b.text).toLowerCase().includes(needle),
  );
}
