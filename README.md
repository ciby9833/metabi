# ChatBI - 智能数据分析对话平台

ChatBI 是一个对话式数据分析平台，支持自然语言提问、SQL 生成、数据查询、图表展示、数据源管理和定时任务。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | Next.js 14, React 18, TypeScript, Ant Design, ECharts |
| 后端 | Node.js 24, NestJS 10, TypeScript, TypeORM |
| 数据库 | PostgreSQL 17, Redis 7 |
| LLM | OpenAI, Gemini, DeepSeek |
| 数据导入 | PostgreSQL `COPY`，Excel 导入脚本见 `backend/scripts/import-split-result.py` |

## 项目结构

```text
Cargo_matebi/
├── backend/
│   ├── src/
│   │   ├── main.ts                 # NestJS 应用入口
│   │   ├── app.module.ts           # 根模块
│   │   ├── config/                 # 配置
│   │   ├── core/                   # Agent 和 SQL Engine
│   │   ├── database/entities/      # TypeORM 实体
│   │   ├── modules/                # health/chat/datasource/task/auth
│   │   └── providers/              # LLM、连接器、语义层、飞书
│   ├── scripts/
│   │   ├── init.sql                # 元数据库初始化
│   │   ├── seed-s2-demo.sh         # S2 demo 数据导入
│   │   ├── seed-s2-demo.sql
│   │   └── import-split-result.py  # Excel 明细导入工具
│   ├── split_result/               # Excel 源文件目录
│   ├── docker-compose.yml
│   ├── package.json
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   └── styles/
│   └── package.json
├── docs/
└── scripts/setup.sh
```

## 快速启动

### 前置条件

- Node.js 24+
- npm 10+
- Docker 和 Docker Compose

### 一键准备

```bash
cd /Users/ellis/Documents/Cargo_matebi
bash scripts/setup.sh
```

### 手动启动

后端依赖和基础设施：

```bash
cd /Users/ellis/Documents/Cargo_matebi/backend
npm install
docker compose up -d
npm run dev
```

前端：

```bash
cd /Users/ellis/Documents/Cargo_matebi/frontend
npm install
npm run dev
```

默认访问地址：

| 服务 | 地址 |
| --- | --- |
| 前端 | http://localhost:3001 |
| 后端 API | http://localhost:3050/api |
| Swagger | http://localhost:3050/api/docs |
| PostgreSQL | localhost:55433 |
| Redis | localhost:6379 |

## 常用数据初始化

导入 S2 demo 数据：

```bash
cd /Users/ellis/Documents/Cargo_matebi/backend
bash scripts/seed-s2-demo.sh
```

重新导入 `backend/split_result` 下的 Excel 明细：

```bash
cd /Users/ellis/Documents/Cargo_matebi/backend
/Users/ellis/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/import-split-result.py split_result --truncate
```

导入目标表：

```text
dwd.dispatcher_efficiency_detail
```

## 环境变量

后端配置文件：[backend/.env](/Users/ellis/Documents/Cargo_matebi/backend/.env)

关键变量：

```bash
PORT=3050
API_PREFIX=api

DATABASE_HOST=localhost
DATABASE_PORT=55433
DATABASE_USER=chatbi_user
DATABASE_PASSWORD=chatbi_password
DATABASE_NAME=chatbi_db

REDIS_HOST=localhost
REDIS_PORT=6379

OPENAI_API_KEY=...
GEMINI_API_KEY=...
DEEPSEEK_API_KEY=...
```

前端配置文件：[frontend/.env](/Users/ellis/Documents/Cargo_matebi/frontend/.env)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3050/api
```

## API 概览

```text
GET    /api/health
GET    /api/health/ready

POST   /api/chat
POST   /api/chat/conversations
GET    /api/chat/conversations
GET    /api/chat/conversations/:id/history
DELETE /api/chat/conversations/:id

GET    /api/datasource
POST   /api/datasource
POST   /api/datasource/test
GET    /api/datasource/:id
PATCH  /api/datasource/:id
DELETE /api/datasource/:id

GET    /api/task
POST   /api/task
GET    /api/task/:id
PATCH  /api/task/:id
DELETE /api/task/:id
POST   /api/task/:id/execute

POST   /api/auth/login
POST   /api/auth/verify
```

## 开发命令

后端：

```bash
cd backend
npm run dev
npm run build
npm run prod
npm run test
npm run lint
```

前端：

```bash
cd frontend
npm run dev
npm run build
npm run start
npm run type-check
```

## 排查

数据库连接失败：

```bash
cd backend
docker compose ps
docker compose logs postgres
PGPASSWORD=chatbi_password psql -h localhost -p 55433 -U chatbi_user -d chatbi_db
```

端口占用：

```bash
lsof -nP -iTCP:3050 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:55433 -sTCP:LISTEN
```
