import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Datasource, DatasourceMetadata, SchemaEmbedding } from '../../database/entities';
import { SchemaIndexService } from './schema-index.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SchemaEmbedding, Datasource, DatasourceMetadata])],
  providers: [SchemaIndexService],
  exports: [SchemaIndexService],
})
export class SchemaIndexModule {}
