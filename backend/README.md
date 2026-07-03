# ChatBI Backend - NestJS

Node.js 24 + NestJS 后端实现，提供对话分析、SQL 生成、数据接入等核心功能。

## 技术栈

| 组件 | 版本 | 说明 |
|-----|------|------|
| **Node.js** | 24+ | JavaScript 运行时 |
| **NestJS** | 10+ | TypeScript 企业级框架 |
| **PostgreSQL** | 17+ | 关系数据库 + pgvector |
| **Redis** | 7+ | 缓存和消息队列 |
| **TypeORM** | 0.3+ | ORM 框架 |
| **Passport** | 0.7+ | 认证框架 |
| **Swagger** | 7+ | API 文档 |

## 项目结构

```
backend/
├── src/
│   ├── main.ts                 # 应用入口
│   ├── app.module.ts          # 根模块
│   │
│   ├── config/                # 配置管理
│   │   ├── app.config.ts      # 应用配置
│   │   └── database.config.ts # 数据库配置
│   │
│   ├── modules/               # 功能模块
│   │   ├── health/            # 健康检查
│   │   ├── chat/              # 对话管理
│   │   ├── datasource/        # 数据源管理
│   │   ├── task/              # 任务调度
│   │   ├── dashboard/         # 看板管理
│   │   └── auth/              # 认证授权
│   │
│   ├── database/              # 数据库
│   │   ├── entities/          # 数据库实体
│   │   ├── repositories/      # 数据仓库
│   │   └── migrations/        # 迁移脚本
│   │
│   ├── common/                # 通用模块
│   │   ├── decorators/        # 自定义装饰器
│   │   ├── filters/           # 异常过滤器
│   │   ├── guards/            # 守卫
│   │   ├── interceptors/      # 拦截器
│   │   ├── middleware/        # 中间件
│   │   ├── pipes/             # 管道
│   │   ├── dto/               # 数据传输对象
│   │   └── utils/             # 工具函数
│   │
│   └── providers/             # 服务提供商
│       ├── llm/               # LLM 提供商
│       ├── connector/         # 数据连接器
│       └── semantic/          # 语义层
│
├── test/                      # 测试
├── dist/                      # 编译输出
├── package.json              # NPM 依赖
├── tsconfig.json            # TypeScript 配置
├── .env.example             # 环境变量示例
└── docker-compose.yml       # Docker 编排
```

## 快速启动

### 前置条件

- Node.js 24+
- npm 或 pnpm
- PostgreSQL 17+ (Docker 推荐)
- Redis 7+ (Docker 推荐)

### 安装和启动

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加你的 API Key

# 3. 启动数据库和缓存（Docker）
docker compose up -d

# 4. 等待数据库初始化 (~30 秒)
sleep 30

# 5. 启动应用
npm run dev      # 开发模式 (带热重载)
npm run start    # 生产模式
```

### 开发命令

```bash
# 启动开发服务器 (hot-reload)
npm run dev

# 调试模式
npm run debug

# 构建生产版本
npm run build

# 启动生产版本
npm run prod

# 运行测试
npm run test
npm run test:watch
npm run test:cov

# 代码检查和格式化
npm run lint
npm run format
```

## API 文档

启动应用后，访问 Swagger UI：

```
http://localhost:3050/api/docs
```

### 主要端点

```
GET    /api/health              健康检查
GET    /api/health/ready        就绪检查

POST   /api/chat                发送消息
GET    /api/chat/conversations  获取对话列表
GET    /api/chat/conversations/:id/history  获取历史

GET    /api/datasource          数据源列表
POST   /api/datasource          创建数据源
POST   /api/datasource/test     测试连接
GET    /api/datasource/:id      获取详情

GET    /api/task                任务列表
POST   /api/task                创建任务
POST   /api/task/:id/execute    执行任务
GET    /api/task/:id            获取详情

POST   /api/auth/login          登录
POST   /api/auth/verify         验证 Token
```

## 模块架构

### Health 模块

健康检查和就绪检查端点。

```typescript
GET /api/health
// 返回应用健康状态、版本、内存使用等信息

GET /api/health/ready
// 返回依赖服务就绪状态
```

### Chat 模块 (W2-W3 实现)

对话管理、消息存储、SQL 生成等。

```typescript
POST /api/chat
// 发送用户消息，触发 LLM 处理流程

GET /api/chat/conversations
// 获取用户的所有对话列表

GET /api/chat/conversations/:id/history
// 获取特定对话的消息历史
```

### Datasource 模块 (W2-W3 实现)

数据源管理、连接池、Schema 检索等。

```typescript
GET /api/datasource
// 获取所有数据源

POST /api/datasource
// 创建新数据源 (PostgreSQL, MySQL, API, CSV 等)

POST /api/datasource/test
// 测试数据库连接

GET /api/datasource/:id
// 获取数据源详情和 Schema
```

### Task 模块 (W5-W6 实现)

定时任务调度、Cron 表达式、执行历史等。

```typescript
GET /api/task
// 获取任务列表

POST /api/task
// 创建定时任务

POST /api/task/:id/execute
// 手动执行任务

GET /api/task/:id
// 获取任务详情
```

### Auth 模块

JWT 认证、令牌生成和验证。

```typescript
POST /api/auth/login
// 用户登录，返回 JWT Token

POST /api/auth/verify
// 验证 Token 有效性
```

## 配置管理

使用 NestJS Config 和 Joi 进行配置管理：

```typescript
// config/app.config.ts - 应用配置
export const appConfig = registerAs('app', () => ({
  name: process.env.APP_NAME,
  port: process.env.PORT,
  jwt: { ... },
  llm: { ... },
  sql: { ... },
}));

// 在服务中使用
constructor(private configService: ConfigService) {
  const port = this.configService.get('app.port');
  const apiKey = this.configService.get('app.llm.openai.apiKey');
}
```

## 数据库

### TypeORM + PostgreSQL 17

```typescript
// src/database/entities/conversation.entity.ts
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 迁移

```bash
# 生成迁移
npm run typeorm:migration:generate -- --name CreateConversationTable

# 运行迁移
npm run typeorm:migration:run

# 回滚迁移
npm run typeorm:migration:revert
```

## 认证和授权

使用 Passport + JWT：

```typescript
// 在 controller 中使用
@UseGuards(AuthGuard('jwt'))
@Get('protected')
protectedRoute(@Request() req) {
  const userId = req.user.userId;
}
```

## 缓存

使用 Redis 进行结果缓存：

```typescript
// 在 service 中使用
@Inject(CACHE_MANAGER)
private cacheManager: Cache;

// 获取缓存
const cached = await this.cacheManager.get('key');

// 设置缓存
await this.cacheManager.set('key', value, 3600);
```

## 定时任务

使用 NestJS Schedule：

```typescript
// 每天零点运行
@Cron('0 0 * * *')
async handleDailyTasks() {
  // 任务逻辑
}

// 每 10 秒运行一次
@Interval(10000)
async handleInterval() {
  // 任务逻辑
}
```

## 日志

使用内置 Logger：

```typescript
import { Logger } from '@nestjs/common';

export class MyService {
  private readonly logger = new Logger(MyService.name);

  someMethod() {
    this.logger.log('Info message');
    this.logger.error('Error message');
    this.logger.debug('Debug message');
  }
}
```

## 测试

### 单元测试

```bash
npm run test
npm run test:watch
npm run test:cov
```

### 集成测试

```bash
npm run test:e2e
```

### 示例测试文件

```typescript
// health.service.spec.ts
describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return health status', () => {
    const result = service.getHealth();
    expect(result.status).toBe('healthy');
  });
});
```

## Docker 部署

### 构建镜像

```bash
docker build -t chatbi-backend:latest .
```

### 运行容器

```bash
docker run -d \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  -e OPENAI_API_KEY=... \
  -p 3050:3050 \
  chatbi-backend:latest
```

### Docker Compose

```bash
docker compose up -d
```

## 性能优化

### 连接池

```typescript
// TypeORM 配置中设置
{
  extra: {
    max: 20,
    min: 5,
  }
}
```

### 查询缓存

```typescript
// SQL 结果缓存到 Redis
const cacheKey = `sql:${hash(sql)}`;
const cached = await this.cache.get(cacheKey);
if (cached) return cached;
```

### 请求日志拦截器

```typescript
// 记录请求耗时
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const start = Date.now();
    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        console.log(`Request took ${duration}ms`);
      }),
    );
  }
}
```

## 扩展模块

### 添加新模块

```bash
# 使用 NestJS CLI 生成
nest generate resource modules/mymodule
```

### 添加新服务

```bash
nest generate service modules/mymodule/services/myservice
```

### 添加新控制器

```bash
nest generate controller modules/mymodule/controllers/mycontroller
```

## 故障排查

### 数据库连接失败

```bash
# 检查 PostgreSQL 容器
docker ps | grep postgres

# 查看日志
docker logs chatbi-postgres

# 测试连接
PGPASSWORD=chatbi_password psql -h localhost -p 55433 -U chatbi_user -d chatbi_db
```

### Redis 连接失败

```bash
# 检查 Redis 容器
docker ps | grep redis

# 测试连接
redis-cli ping
```

### 端口被占用

```bash
# 查看占用后端端口的进程
lsof -i :3050

# 更改 PORT 环境变量
PORT=3051 npm run dev
```

### 内存溢出

```bash
# 增加 Node.js 堆内存
node --max-old-space-size=4096 dist/main
```

## 开发最佳实践

1. **模块化** - 每个功能是一个独立模块
2. **依赖注入** - 使用 NestJS 的 DI 系统
3. **类型安全** - 充分利用 TypeScript
4. **错误处理** - 自定义异常过滤器
5. **日志记录** - 使用内置 Logger
6. **缓存策略** - 合理使用 Redis
7. **测试覆盖** - 编写单元和集成测试
8. **代码质量** - 使用 ESLint 和 Prettier

## 许可证

MIT

## 联系方式

- 问题: GitHub Issues
- 文档: [设计文档](../README.md)

---

**版本**: v0.1.0 (MVP)  
**最后更新**: 2026-06-15  
**下一阶段**: W2-W3 - 数据接入 + 语义层
