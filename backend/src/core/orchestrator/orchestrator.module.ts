import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module';
import { SqlEngineModule } from '../sql-engine/sql-engine.module';
import { ToolsModule } from '../tools/tools.module';
import { ConnectorModule } from '../../providers/connector/connector.module';
import { Conversation, Datasource, TurnEvent } from '../../database/entities';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { LineageService } from './lineage.service';
import { TurnRuntimeService } from './turn-runtime.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Datasource, Conversation, TurnEvent]),
    AgentsModule,
    SqlEngineModule,
    ToolsModule,
    ConnectorModule,
  ],
  providers: [ChatOrchestratorService, LineageService, TurnRuntimeService],
  exports: [ChatOrchestratorService, LineageService, TurnRuntimeService],
})
export class OrchestratorModule {}
