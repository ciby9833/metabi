# ChatBI 后端部署指南

## 数据库 Schema 管理（重要）

### 三种环境的行为

| 环境 | NODE_ENV | TypeORM synchronize | 启动时自动跑 migration |
|---|---|---|---|
| 本地开发 | `development` | ✅ on（entity 改了自动建表）| ❌ off |
| 生产 / staging | `production` | ❌ off | ✅ on（启动前自动 run 未执行的 migration）|

**生产从来不靠 synchronize**。所有 schema 变更必须走 migration 文件。

---

## 首次部署到全新数据库

```bash
# 1) 起 PostgreSQL（init.sql 自动跑：建 schema + 扩展）
docker compose up -d postgres

# 2) 启动 backend
NODE_ENV=production npm run prod
# → 启动时检测到 typeorm_migrations 表为空
# → 自动跑 src/database/migrations/*.ts 全部 migration（含 baseline）
# → 16 张业务表建好

# 3) 管理员账号会被 AuthService.onModuleInit 自动 seed
#    邮箱: noelgfr@gmail.com
#    密码: xiaotao4vip
#    （生产环境上线后第一件事：登录改密码）
```

也可手动一步步走，便于调试：
```bash
# 仅建表，不启动应用
NODE_ENV=production npm run migration:run-prod
# 再启动
npm run prod
```

---

## 已有 dev DB 升级到 migration 体系（已完成，**仅一次性**）

如果 DB 已经被 `synchronize` 自动建出了 16 张表，需要告诉 TypeORM「这些表已经存在，别再 run baseline」：

```bash
PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -p $DATABASE_PORT \
  -U $DATABASE_USER -d $DATABASE_NAME <<'SQL'
CREATE TABLE IF NOT EXISTS typeorm_migrations (
  id SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL
);
INSERT INTO typeorm_migrations ("timestamp", name)
SELECT 1700000000000, 'InitialSchema1700000000000'
WHERE NOT EXISTS (SELECT 1 FROM typeorm_migrations WHERE name = 'InitialSchema1700000000000');
SQL
```

---

## 日常开发：改了 entity 怎么办

**禁止**直接改 dev DB（synchronize 会自动同步，但生产不会知道）。正确流程：

```bash
# 1) 改 entity 文件（src/database/entities/xxx.entity.ts）

# 2) 自动从 entity vs 当前 DB 的差异生成 migration
npm run migration:generate -- src/database/migrations/AddXxxColumn
# → 生成 src/database/migrations/1700001234567-AddXxxColumn.ts

# 3) 看一眼生成的 SQL 对不对
cat src/database/migrations/1700001234567-AddXxxColumn.ts

# 4) 在 dev 跑一次，验证
npm run migration:run

# 5) commit migration 文件进 git
git add src/database/migrations/
git commit -m "feat: add xxx column"

# 6) 部署到生产时，NestJS 启动会自动跑这个 migration
```

如果只想看 pending migration，不执行：
```bash
npm run migration:show
# [X] 1 InitialSchema1700000000000     ← 已执行
# [ ] 2 AddXxxColumn1700001234567       ← 未执行
```

回滚最近一个 migration（仅 dev / staging，**生产慎用**）：
```bash
npm run migration:revert
```

---

## Migration 文件目录结构

```
src/database/
├── data-source.ts                    # TypeORM CLI 配置（独立于 NestJS）
├── entities/                         # ORM entity
└── migrations/
    └── 1700000000000-InitialSchema.ts # baseline（16 张表）
```

新 migration 文件**永远不要**改名 / 改 timestamp，否则会被认为是新的，重复执行。

---

## Docker 部署完整流程

```bash
# .env 准备
NODE_ENV=production
DATABASE_HOST=postgres   # docker 网络
DATABASE_PORT=5432
DATABASE_NAME=chatbi_db
DATABASE_USER=chatbi_user
DATABASE_PASSWORD=...

JWT_SECRET=...           # 必改：openssl rand -base64 64
JWT_REFRESH_SECRET=...   # 必改

MAIL_ENABLED=true
MAIL_HOST=smtp.xxx.com
...

# 启动
docker compose up -d postgres redis
NODE_ENV=production npm run build
NODE_ENV=production npm run prod
```

---

## 生产 first-time checklist

- [ ] `.env` 配置完整（JWT secret 必须改）
- [ ] PostgreSQL 起来，`init.sql` 跑过（schema + extension 建好）
- [ ] 启动 NestJS 后查看日志：
  - `[Bootstrap admin created: noelgfr@gmail.com]`
  - `[Migration InitialSchema1700000000000 has been executed]`（如果是全新 DB）
- [ ] 登录管理员账号，**立刻修改密码**
- [ ] 关闭注册（如果不想任何人都能注册）：`REGISTRATION_ENABLED=false`
- [ ] 配置邮件白名单（如果想限制邮箱域名）：`REGISTRATION_ALLOWED_EMAIL_DOMAINS=company.com`
