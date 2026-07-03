import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, Project, SubAgentCall, User } from '../../database/entities';
import { ChartAgent } from './chart.agent';
import { NarratorAgent } from './narrator.agent';
import { PlannerAgent } from './planner.agent';
import { MasterPlannerAgent } from './master-planner.agent';
import { ReviewerAgent } from './reviewer.agent';
import { StatisticalInsightService } from './statistical-insight.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Project, SubAgentCall, User])],
  providers: [
    ChartAgent,
    NarratorAgent,
    PlannerAgent,
    MasterPlannerAgent,
    ReviewerAgent,
    StatisticalInsightService,
  ],
  exports: [
    ChartAgent,
    NarratorAgent,
    PlannerAgent,
    MasterPlannerAgent,
    ReviewerAgent,
    StatisticalInsightService,
  ],
})
export class AgentsModule {}
