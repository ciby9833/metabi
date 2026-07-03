/**
 * 独立的 DataSource 配置 — 供 TypeORM CLI 用（migration:generate / migration:run）
 *
 * 跟 app.module.ts 里的 TypeOrmModule 配置同源（都从 .env 读取）。
 * 这里**不能依赖** Nest 的 ConfigService，因为 CLI 跑的时候 Nest 还没启动。
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as Entities from './entities';

// 加载 .env（CLI 入口）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'chatbi_user',
  password: process.env.DATABASE_PASSWORD || 'chatbi_password',
  database: process.env.DATABASE_NAME || 'chatbi_db',
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
  ],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false, // 永远 false — 这是 CLI 专用，绝不自动建表
  logging: process.env.DB_LOGGING === 'true',
});
