import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';

// 业务模块
import { HealthModule } from './modules/health/health.module';
import { ChatModule } from './modules/chat/chat.module';
import { DatasetModule } from './modules/dataset/dataset.module';
import { ExportsModule } from './modules/exports/exports.module';
import { UserProfileModule } from './modules/user-profile/user-profile.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ChatAttachmentsModule } from './modules/chat-attachments/chat-attachments.module';
import { EvalModule } from './eval/eval.module';
import { DatasourceModule } from './modules/datasource/datasource.module';
import { TaskModule } from './modules/task/task.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { ProjectModule } from './modules/project/project.module';
import { SkillsApiModule } from './modules/skills/skills.module';

// 核心 / 提供商模块
import { LLMModule } from './providers/llm/llm.module';
import { ConnectorModule } from './providers/connector/connector.module';
import { SkillsModule } from './providers/skills/skills.module';
import { FeishuModule } from './providers/feishu/feishu.module';
import { SchemaIndexModule } from './providers/schema-index/schema-index.module';
import { ToolsModule } from './core/tools/tools.module';
import { SqlEngineModule } from './core/sql-engine/sql-engine.module';
import { AgentsModule } from './core/agents/agents.module';
import { OrchestratorModule } from './core/orchestrator/orchestrator.module';

import { appConfig, databaseConfig } from './config';
import * as Entities from './database/entities';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      envFilePath: '.env',
    }),

    // 数据库模块
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('db.host'),
        port: configService.get<number>('db.port'),
        username: configService.get<string>('db.username'),
        password: configService.get<string>('db.password'),
        database: configService.get<string>('db.name'),
        entities: [
          Entities.User,
          Entities.Conversation,
          Entities.Message,
          Entities.Datasource,
          Entities.Task,
          Entities.SqlRecord,
          Entities.DatasourceMetadata,
          Entities.DatasourceGlossary,
          Entities.SuggestedQuestion,
          Entities.MessageFeedback,
          Entities.TurnArtifact,
          Entities.SchemaEmbedding,
          Entities.SkillEntity,
          Entities.EmailVerification,
          Entities.UserOAuthBinding,
          Entities.Project,
          Entities.ProjectMember,
          Entities.SubAgentCall,
          Entities.TurnEvent,
          Entities.UserDataset,
          Entities.ExportedFile,
          Entities.UserProfile,
          Entities.Dashboard,
          Entities.Widget,
          Entities.ChatAttachment,
        ],
        // Migration 文件加载：
        //   dev：不加载（synchronize=true 自动建表；CLI 跑 migration 走独立 data-source.ts）
        //        这样避免 nest 的 commonjs 加载器尝试 require .ts ESM 文件出错
        //   prod：加载编译后的 dist/*.js，由 migrationsRun=true 启动时自动跑
        migrations:
          configService.get<string>('NODE_ENV') === 'development'
            ? []
            : ['dist/database/migrations/*.js'],
        migrationsTableName: 'typeorm_migrations',
        migrationsRun: configService.get<string>('NODE_ENV') !== 'development',
        synchronize: configService.get<string>('NODE_ENV') === 'development',
        logging: configService.get<boolean>('db.logging') || false,
        maxQueryExecutionTime: 1000,
      }),
    }),

    // 缓存模块 (默认内存，配置好 Redis 后替换为 redisStore)
    CacheModule.register({
      isGlobal: true,
      ttl: 3600,
    }),

    // 调度模块
    ScheduleModule.forRoot(),

    // 提供商模块（全局）
    LLMModule,
    ConnectorModule,
    SkillsModule,
    FeishuModule,
    SchemaIndexModule,
    SqlEngineModule,
    ToolsModule,
    AgentsModule,
    OrchestratorModule,

    // 业务模块
    MailModule,
    AuthModule,
    ProjectModule,
    HealthModule,
    ChatModule,
    DatasourceModule,
    DatasetModule,
    TaskModule,
    SkillsApiModule,
    ExportsModule,
    UserProfileModule,
    DashboardModule,
    ChatAttachmentsModule,
    EvalModule,
  ],
  providers: [],
})
export class AppModule {}
