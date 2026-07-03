import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.types';
import { ListTablesTool } from './list-tables.tool';
import { DescribeTableTool } from './describe-table.tool';
import { SampleRowsTool } from './sample-rows.tool';
import { RunSqlTool } from './run-sql.tool';
import { FinalizeTool } from './finalize.tool';
import { ExportTableTool } from './export-table.tool';
import { ListPreviousTurnsTool } from './list-previous-turns.tool';
import { RecallTurnResultTool } from './recall-turn-result.tool';
import { RecallTurnMessagesTool } from './recall-turn-messages.tool';
import { DecomposeByDimensionsTool } from './decompose-by-dimensions.tool';
import { ComparePeriodsTool } from './compare-periods.tool';
import { CohortRetentionTool } from './cohort-retention.tool';
import { FunnelConversionTool } from './funnel-conversion.tool';
import { ForecastTool } from './forecast.tool';
import { SearchTablesTool } from './search-tables.tool';
import { CiteIndustryBenchmarkTool } from './cite-industry-benchmark.tool';
import { MultidimBreakdownTool } from './multidim-breakdown.tool';
import { StatsDescribeTool } from './stats-describe.tool';

/**
 * ToolRegistry
 *
 * 统一注册和按名查找所有 Tool。
 * - 数据探索类：list_tables / describe_table / sample_rows / run_sql
 * - 多轮召回类：list_previous_turns / recall_turn_result / recall_turn_messages
 * - 收尾：finalize
 */
@Injectable()
export class ToolRegistry {
  private readonly map: Map<string, AgentTool> = new Map();

  constructor(
    private readonly listTables: ListTablesTool,
    private readonly describeTable: DescribeTableTool,
    private readonly sampleRows: SampleRowsTool,
    private readonly runSql: RunSqlTool,
    private readonly listPreviousTurns: ListPreviousTurnsTool,
    private readonly recallTurnResult: RecallTurnResultTool,
    private readonly recallTurnMessages: RecallTurnMessagesTool,
    private readonly decomposeByDimensions: DecomposeByDimensionsTool,
    private readonly comparePeriods: ComparePeriodsTool,
    private readonly cohortRetention: CohortRetentionTool,
    private readonly funnelConversion: FunnelConversionTool,
    private readonly forecast: ForecastTool,
    private readonly searchTables: SearchTablesTool,
    private readonly citeIndustryBenchmark: CiteIndustryBenchmarkTool,
    private readonly multidimBreakdown: MultidimBreakdownTool,
    private readonly statsDescribe: StatsDescribeTool,
    private readonly exportTable: ExportTableTool,
    private readonly finalize: FinalizeTool,
  ) {
    [
      listTables,
      searchTables,
      describeTable,
      sampleRows,
      runSql,
      listPreviousTurns,
      recallTurnResult,
      recallTurnMessages,
      decomposeByDimensions,
      comparePeriods,
      cohortRetention,
      funnelConversion,
      forecast,
      citeIndustryBenchmark,
      multidimBreakdown,
      statsDescribe,
      exportTable,
      finalize,
    ].forEach((t) => this.map.set(t.definition.name, t));
  }

  getAll(): AgentTool[] {
    return Array.from(this.map.values());
  }

  getByName(name: string): AgentTool | undefined {
    return this.map.get(name);
  }

  /** finalize 是个特殊工具 —— Planner 单独检测 */
  isFinalize(name: string): boolean {
    return name === this.finalize.definition.name;
  }
}
