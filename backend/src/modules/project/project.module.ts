import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './services/project.service';
import { Project, ProjectMember, User } from '../../database/entities';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, User])],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
