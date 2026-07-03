import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatasourceController } from './controllers/datasource.controller';
import { MetadataController } from './controllers/metadata.controller';
import { DatasourceService } from './services/datasource.service';
import { DatasourceMetadataService } from './services/metadata.service';
import {
  Datasource,
  DatasourceGlossary,
  DatasourceMetadata,
  SuggestedQuestion,
} from '../../database/entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Datasource,
      DatasourceMetadata,
      DatasourceGlossary,
      SuggestedQuestion,
    ]),
  ],
  controllers: [DatasourceController, MetadataController],
  providers: [DatasourceService, DatasourceMetadataService],
  exports: [DatasourceService, DatasourceMetadataService],
})
export class DatasourceModule {}
