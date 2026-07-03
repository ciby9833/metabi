import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities';
import { EvalRunnerService } from './eval-runner.service';
import { EvalJudgeService } from './eval-judge.service';
import { EvalReportService } from './eval-report.service';
import { EvalHistoryService } from './eval-history.service';
import { EvalController } from './eval.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [EvalController],
  providers: [
    EvalRunnerService,
    EvalJudgeService,
    EvalReportService,
    EvalHistoryService,
  ],
  exports: [
    EvalRunnerService,
    EvalJudgeService,
    EvalReportService,
    EvalHistoryService,
  ],
})
export class EvalModule {}
