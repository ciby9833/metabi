import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkillEntity } from '../../database/entities';
import { SkillLoaderService } from './skill-loader.service';
import { SkillRouterService } from './skill-router.service';
import { SkillEditorService } from './skill-editor.service';

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([SkillEntity])],
  providers: [SkillLoaderService, SkillRouterService, SkillEditorService],
  exports: [SkillLoaderService, SkillRouterService, SkillEditorService],
})
export class SkillsModule {}
