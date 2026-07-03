import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorModule } from '../../providers/connector/connector.module';
import { SqlEngineModule } from '../sql-engine/sql-engine.module';
import { Datasource } from '../../database/entities';
import { ListTablesTool } from './list-tables.tool';
import { DescribeTableTool } from './describe-table.tool';
import { SampleRowsTool } from './sample-rows.tool';
import { RunSqlTool } from './run-sql.tool';
import { FinalizeTool } from './finalize.tool';
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
import { ExportTableTool } from './export-table.tool';
import { ToolRegistry } from './tool-registry.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Datasource]), ConnectorModule, SqlEngineModule],
  providers: [
    ListTablesTool,
    DescribeTableTool,
    SampleRowsTool,
    RunSqlTool,
    FinalizeTool,
    ListPreviousTurnsTool,
    RecallTurnResultTool,
    RecallTurnMessagesTool,
    DecomposeByDimensionsTool,
    ComparePeriodsTool,
    CohortRetentionTool,
    FunnelConversionTool,
    ForecastTool,
    SearchTablesTool,
    CiteIndustryBenchmarkTool,
    MultidimBreakdownTool,
    StatsDescribeTool,
    ExportTableTool,
    ToolRegistry,
  ],
  exports: [ToolRegistry, FinalizeTool],
})
export class ToolsModule {}
