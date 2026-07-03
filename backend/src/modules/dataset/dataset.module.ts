import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserDataset, ProjectMember, Project } from '../../database/entities';
import { DatasetController } from './controllers/dataset.controller';
import { DatasetService } from './services/dataset.service';
import { DatasetParserService } from './services/dataset-parser.service';
import { DatasetImportService } from './services/dataset-import.service';
import { ProjectSkillAssemblerService } from './services/project-skill-assembler.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([UserDataset, ProjectMember, Project]),
    MulterModule.register({
      storage: memoryStorage(), // 文件留在内存（MVP），50MB 上限保护
    }),
  ],
  controllers: [DatasetController],
  providers: [
    DatasetService,
    DatasetParserService,
    DatasetImportService,
    ProjectSkillAssemblerService,
  ],
  exports: [DatasetService, ProjectSkillAssemblerService],
})
export class DatasetModule {}
