import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorModule } from '../../providers/connector/connector.module';
import { SqlSafetyService } from './sql-safety.service';
import { SqlExecutorService } from './sql-executor.service';
import { SqlRecord, Datasource } from '../../database/entities';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SqlRecord, Datasource]), ConnectorModule],
  providers: [SqlSafetyService, SqlExecutorService],
  exports: [SqlSafetyService, SqlExecutorService],
})
export class SqlEngineModule {}
