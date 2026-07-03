import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserDataset, Project } from '../../../database/entities';

export interface AssembledProjectSkill {
  /** 注入 Planner 的 system prompt（含 Project Instruction + dataset schema 描述）*/
  systemPrompt: string;
  /** SQL 白名单（强权限隔离，Planner / 工具都受限）*/
  allowedTables: string[];
  /** 用于 UI 显示的 dataset 元信息（chip / header 用）*/
  selectedDatasets: Array<{
    id: string;
    displayName: string;
    rowCount: number | null;
    tableName: string;
  }>;
}

/**
 * Project Skill 动态装配器（学 Claude Project Instructions）。
 *
 * 触发时机：用户在 chat 选了「我的数据集」模式 + 1 个 project + N 个 dataset
 *           ChatService 调本服务装配一份「ProjectSkill」喂给 Planner。
 *
 * 关键设计：
 *   - ProjectSkill 不存入 skill 库（不污染搜索）
 *   - System prompt 完全由 Project.instruction + dataset 元数据组装，
 *     不引用任何企业 Skill 的领域知识
 *   - 白名单仅含本次选中的 dataset.table（Planner 即使尝试 describe_table 其他表
 *     也会被 SQL engine + tools 双重拦截）
 */
@Injectable()
export class ProjectSkillAssemblerService {
  private readonly logger = new Logger(ProjectSkillAssemblerService.name);

  constructor(
    @InjectRepository(UserDataset)
    private readonly datasetRepo: Repository<UserDataset>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  /**
   * 装配 ProjectSkill。
   *
   * @param projectId 用户当前选中的 project
   * @param datasetIds 用户选中要参与对话的 dataset id 列表（多选 → 自动 join）
   *                   必须是该 project 下的（调用方负责权限校验）
   */
  async assemble(projectId: string, datasetIds: string[]): Promise<AssembledProjectSkill> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    if (datasetIds.length === 0) {
      throw new NotFoundException('至少需要选中一个 dataset');
    }

    const datasets = await this.datasetRepo.findByIds(datasetIds);
    if (datasets.length !== datasetIds.length) {
      throw new NotFoundException('部分 dataset 不存在');
    }

    // 必须全部属于本 project（防越权）+ 状态 ready
    for (const ds of datasets) {
      if (ds.projectId !== projectId) {
        throw new NotFoundException(
          `Dataset ${ds.displayName} 不属于该项目，请重新选择`,
        );
      }
      if (ds.status !== 'ready' || !ds.tableName) {
        throw new NotFoundException(
          `Dataset ${ds.displayName} 尚未就绪（${ds.status}）`,
        );
      }
    }

    const allowedTables = datasets.map((d) => `user_data.${d.tableName!}`);
    const systemPrompt = this.buildSystemPrompt(project, datasets);

    this.logger.log(
      `Assembled ProjectSkill for project=${projectId}, datasets=${datasets.length}, tables=${allowedTables.join(',')}`,
    );

    return {
      systemPrompt,
      allowedTables,
      selectedDatasets: datasets.map((d) => ({
        id: d.id,
        displayName: d.displayName,
        rowCount: d.rowCount,
        tableName: d.tableName!,
      })),
    };
  }

  /** System prompt = Project Instruction + 所有选中 dataset 的 schema 详描 + 推理约束 */
  private buildSystemPrompt(project: Project, datasets: UserDataset[]): string {
    const sections: string[] = [];

    sections.push('# 📁 用户自助数据分析（Project Knowledge 模式）');
    sections.push(
      `当前在 **${project.name}** 项目下，对话仅查询以下用户上传的数据集（已白名单严格限制）。`,
    );

    if (project.systemInstructions?.trim()) {
      sections.push('## 项目说明（用户填写，作为分析的业务背景）');
      sections.push(project.systemInstructions.trim());
    }

    sections.push('## 可用的数据表');
    for (const ds of datasets) {
      sections.push(this.formatDatasetSchema(ds));
    }

    sections.push('## 推理约束（必读）');
    sections.push(
      [
        '**1. 严格隔离**',
        '只能查询上面列出的表（用户上传的小型 CSV/Excel）。',
        '不要访问企业数据源（dwd.*, ods.*, ads.*）— 与本次对话无关，且会被拦截。',
        '',
        '**2. 高效推理 — schema 已完整给出**',
        '- ❌ 禁止 `list_tables` / `search_tables` / `describe_table` — 表/列/类型已在上面',
        '- ❌ **schema 表的"真实值示例"列已给出每列 5-8 个真实样本** — 通常不需要再调 `sample_rows`',
        '- ❌ **同一聚合不要重复 run_sql** — 第一次 run_sql 拿到结果就够了，不要"再确认一遍"',
        '- ✅ **立即**：写 `run_sql` 回答用户问题',
        '- ✅ **立即**：`finalize` 输出结果',
        '',
        '**3. 多表 JOIN**',
        '问题涉及多张表时**主动 JOIN**（不要因为"看不出关联"就回避）。',
        '识别关联字段：相同列名 / 相似业务含义（如 `cust_id` ↔ `customer_id`）。',
        '',
        '**4. 不引用企业领域知识**',
        '忘掉"运单/派件/网点"等企业概念。只用本数据的列描述和实际值推理。',
        '',
        '**5. 严禁 clarify（关键！）**',
        '用户上传的数据是他自己的，他比你更清楚范围与口径。',
        '**所有问题都按以下默认计算，不要反问**：',
        '- 时间未指定（"这一周"/"本月"/"最近"）→ 用数据集中的最后一个自然周/月/期间',
        '- 口径未指定（"销量"/"客单价"）→ 用最明显/最常用的字段直接算',
        '- "客单价" → 总金额 ÷ 不同客户数',
        '- "下单量" / "订单量" → COUNT(订单)',
        '- "营收" / "收入" → SUM(金额相关字段)',
        '- "占比" / "百分比" → 子集 COUNT ÷ 全集 COUNT × 100',
        '',
        '想 clarify 时先问自己：用户上传的就这点数据，他在意你帮他**算出来**，不是帮他**审题**。',
        '极少数真的有重大歧义时（如数据集明确有"orders.amount"和"orders.gross_amount"两个金额字段且用户问"金额"），才 clarify。',
        '',
        '**6. 数字精确表达**',
        'narrative 中给关键数字时必须**写精确值**（如 1760、16500、96300）。',
        '严禁"约""大概""左右""差不多"等模糊词。可以同时给中文单位换算（"96,300 元（约 9.6 万）"）。',
        '',
        '**7. 空结果明示**',
        '查询结果为 0/空时，narrative 必须明示 "0" 或 "没有"，**不要**说"暂无数据"等回避表述。',
        '',
        '**典型路径只需 2-3 步**：run_sql → finalize（schema 充分时无需 sample_rows）',
      ].join('\n'),
    );

    return sections.join('\n\n');
  }

  /**
   * 把一个 dataset 渲染成 markdown schema 块。
   *
   * 关键设计：sample 充足给出，目的是让 Planner 不必再调 sample_rows 工具：
   *   - 数值/日期列：5 个真实值（让 LLM 看清范围、格式）
   *   - 文本/布尔类列：去重后最多 8 个 distinct 值（让 LLM 看清枚举边界）
   *   - 单值长度截 40（避免长 text 撑爆 prompt）
   */
  private formatDatasetSchema(ds: UserDataset): string {
    const cols = (ds.columns || []).filter((c) => !c.skipped);
    const rowInfo = ds.rowCount ? `${ds.rowCount} 行` : '行数未知';
    const fileInfo = ds.sourceFilename ? ` · 源文件 ${ds.sourceFilename}` : '';
    const descLine = ds.description ? `\n> ${ds.description}` : '';

    const lines: string[] = [];
    lines.push(`### \`user_data.${ds.tableName}\` — ${ds.displayName}`);
    lines.push(`*${rowInfo}${fileInfo}${descLine}*`);
    lines.push('');
    lines.push('| 列名 | 类型 | 业务描述 | 真实值示例 |');
    lines.push('|---|---|---|---|');
    for (const c of cols) {
      const sampleText = this.renderColumnSamples(c);
      const desc = c.description?.trim() || (c.originalName ? `原列名：${c.originalName}` : '—');
      lines.push(`| \`${c.name}\` | ${c.type} | ${desc} | ${sampleText} |`);
    }
    return lines.join('\n');
  }

  /** 不同类型列采用不同 sample 策略 */
  private renderColumnSamples(c: { type: string; sample?: any[] }): string {
    if (!c.sample || c.sample.length === 0) return '—';
    const fmt = (v: any) => String(v).substring(0, 40);

    // 文本 / 布尔：给 distinct 值（让 LLM 看清枚举边界）
    if (c.type === 'text' || c.type === 'boolean') {
      const distinct = Array.from(new Set(c.sample.map((v) => String(v))))
        .slice(0, 8)
        .map(fmt);
      return distinct.join(' / ');
    }
    // 数值 / 日期：给 5 个真实值（让 LLM 看清范围 + 格式）
    return c.sample.slice(0, 5).map(fmt).join(', ');
  }
}
