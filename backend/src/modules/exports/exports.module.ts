import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, ExportedFile } from '../../database/entities';
import { FileStorageService } from './services/file-storage.service';
import { ExporterService } from './services/exporter.service';
import { ExportsController } from './controllers/exports.controller';

/**
 * Exports Module — 文件导出（Excel/CSV/未来 PDF）
 *
 * @Global：FileStorageService 被 tool 层（core/tools/export-table.tool.ts）注入，
 * 跨模块共用一份实例。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ExportedFile, Conversation])],
  providers: [FileStorageService, ExporterService],
  controllers: [ExportsController],
  exports: [FileStorageService, ExporterService],
})
export class ExportsModule {}
