import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Datasource } from '../../database/entities';
import { ConnectorFactory } from '../../providers/connector/connector.factory';
import { TableStats } from '../../providers/connector/types';

export interface LineageBadge {
  schema: string;
  table: string;
  estimatedRowCount?: number;
  sizeBytes?: number;
  lastActivityAt?: string; // ISO
  lastAnalyzedAt?: string;
  /** human-friendly：N 小时前 / N 天前 */
  lastActivityHuman?: string;
}

/**
 * LineageService
 *
 * 从 SQL 抽出涉及的表 → 查 connector.getTableStats → 组装 badge
 * Orchestrator 在 finalize 后调，附加到结果里
 * 完全自动，零用户输入
 */
@Injectable()
export class LineageService {
  private readonly logger = new Logger(LineageService.name);

  constructor(
    private readonly connectorFactory: ConnectorFactory,
    @InjectRepository(Datasource)
    private readonly datasourceRepo: Repository<Datasource>,
  ) {}

  /**
   * 解析 SQL 抽出涉及的表名（schema.table），查 stats，返回 badge[]
   */
  async buildBadges(sql: string | undefined, datasourceId: string): Promise<LineageBadge[]> {
    if (!sql) return [];
    const tables = this.extractTables(sql);
    if (tables.length === 0) return [];

    const ds = await this.datasourceRepo.findOne({ where: { id: datasourceId } });
    if (!ds) return [];
    const connector = this.connectorFactory.getConnector(ds.id, ds.type, ds.config as any);

    const out: LineageBadge[] = [];
    for (const t of tables) {
      try {
        const stats = await connector.getTableStats(t.table, t.schema);
        if (stats) {
          out.push(this.toBadge(stats));
        }
      } catch (err) {
        this.logger.debug(`getTableStats failed for ${t.schema}.${t.table}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** 从已有的 lineage badges 里挑出"新鲜度可疑"的，产生警告 */
  findStaleWarnings(
    badges: LineageBadge[],
    question: string,
  ): { schema: string; table: string; lastActivityAt: string; message: string }[] {
    const asksAboutRecent =
      /今天|今日|当前|最新|刚才|现在|实时|这几小时/.test(question);
    if (!asksAboutRecent) return [];
    const out: ReturnType<typeof this.findStaleWarnings> = [];
    const now = Date.now();
    for (const b of badges) {
      if (!b.lastActivityAt) continue;
      const ageMs = now - new Date(b.lastActivityAt).getTime();
      if (ageMs > 24 * 3600 * 1000) {
        out.push({
          schema: b.schema,
          table: b.table,
          lastActivityAt: b.lastActivityAt,
          message: `表 ${b.schema}.${b.table} 最近 ${b.lastActivityHuman || '24h+'} 没有写入活动，"今天"的数据可能尚未刷新到位`,
        });
      }
    }
    return out;
  }

  /**
   * 粗解析：从 SQL 抽出 FROM / JOIN 后的表名
   * 不依赖 node-sql-parser（避免额外依赖问题），用正则即可（业务表名相对规整）
   */
  private extractTables(sql: string): { schema: string; table: string }[] {
    const out: { schema: string; table: string }[] = [];
    const seen = new Set<string>();
    // FROM / JOIN 后的标识符 (schema.table 或裸 table)
    const regex = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)?)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sql)) !== null) {
      const raw = m[1];
      const [a, b] = raw.split('.');
      const entry = b ? { schema: a, table: b } : { schema: 'public', table: a };
      const key = `${entry.schema}.${entry.table}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(entry);
      }
    }
    return out;
  }

  private toBadge(stats: TableStats): LineageBadge {
    const now = Date.now();
    const lastActivityHuman = stats.lastActivityAt
      ? this.humanAge(now - stats.lastActivityAt.getTime())
      : undefined;
    return {
      schema: stats.schema,
      table: stats.table,
      estimatedRowCount: stats.estimatedRowCount,
      sizeBytes: stats.sizeBytes,
      lastActivityAt: stats.lastActivityAt?.toISOString(),
      lastAnalyzedAt: stats.lastAnalyzedAt?.toISOString(),
      lastActivityHuman,
    };
  }

  private humanAge(ms: number): string {
    if (ms < 0) return '刚刚';
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(0)} 秒前`;
    if (sec < 3600) return `${(sec / 60).toFixed(0)} 分钟前`;
    if (sec < 86400) return `${(sec / 3600).toFixed(0)} 小时前`;
    return `${(sec / 86400).toFixed(0)} 天前`;
  }
}
