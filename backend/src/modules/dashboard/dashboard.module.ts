import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, Dashboard, TurnArtifact, Widget } from '../../database/entities';
import { DashboardService } from './services/dashboard.service';
import { WidgetService } from './services/widget.service';
import { SqlTemplateService } from './services/sql-template.service';
import { DashboardInterpretService } from './services/dashboard-interpret.service';
import { SuggestParamsService } from './services/suggest-params.service';
import { SuggestDetailSqlService } from './services/suggest-detail-sql.service';
import { DashboardController } from './controllers/dashboard.controller';
import { WidgetController } from './controllers/widget.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Dashboard, Widget, TurnArtifact, Conversation]),
  ],
  providers: [
    DashboardService,
    WidgetService,
    SqlTemplateService,
    DashboardInterpretService,
    SuggestParamsService,
    SuggestDetailSqlService,
  ],
  controllers: [DashboardController, WidgetController],
  exports: [
    DashboardService,
    WidgetService,
    SqlTemplateService,
    DashboardInterpretService,
    SuggestParamsService,
    SuggestDetailSqlService,
  ],
})
export class DashboardModule {}
