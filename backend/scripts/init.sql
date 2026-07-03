-- ============================================================
-- ChatBI 元数据库初始化
-- ============================================================

-- pgcrypto 用于 gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pgvector 用于语义检索（可选，TypeORM 不依赖）
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension is not available, skipping: %', SQLERRM;
END $$;

-- 应用层 schema（元数据）
CREATE SCHEMA IF NOT EXISTS app;

-- dwd schema 仅用于本地 demo 数据（生产环境一般在独立数据库）
CREATE SCHEMA IF NOT EXISTS dwd;

-- 注意：TypeORM 在开发模式下 synchronize=true 会自动建表
-- 这里只做扩展和 schema 初始化，业务表交给 TypeORM 管理。
-- 管理员账号由 backend 启动时的 seed-admin.sh 创建。
