# ChatBI Frontend

Next.js + React + TypeScript 前端实现，提供对话界面、看板编辑、数据管理等功能。

## 项目结构

```
frontend/
├── src/
│   ├── pages/              # 页面
│   │   ├── _app.tsx       # App wrapper
│   │   ├── index.tsx      # 首页重定向
│   │   ├── chat/
│   │   │   ├── index.tsx  # 对话列表
│   │   │   └── [id].tsx   # 对话详情
│   │   ├── dashboard/     # 看板（V1.0+）
│   │   ├── datasource/    # 数据源管理
│   │   ├── task/          # 任务管理
│   │   └── admin/         # 管理后台
│   │
│   ├── components/         # 可复用组件
│   │   ├── layout/        # 布局组件
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── Layout.tsx
│   │   │
│   │   ├── chat/          # 对话相关
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageItem.tsx
│   │   │   ├── InputBox.tsx
│   │   │   └── ActionButtons.tsx
│   │   │
│   │   ├── chart/         # 图表相关
│   │   │   ├── ChartRenderer.tsx
│   │   │   └── TableView.tsx
│   │   │
│   │   ├── datasource/    # 数据源相关
│   │   │   └── DataSourceForm.tsx
│   │   │
│   │   ├── task/          # 任务相关
│   │   │   └── TaskForm.tsx
│   │   │
│   │   └── common/        # 通用组件
│   │       ├── Loading.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── Modal.tsx
│   │
│   ├── lib/               # 工具库
│   │   └── api.ts         # Axios API 客户端
│   │
│   ├── hooks/             # React Hooks
│   │   ├── useChat.ts
│   │   ├── useDatasource.ts
│   │   └── useTask.ts
│   │
│   ├── services/          # API 服务
│   │   ├── api.ts
│   │   ├── chatService.ts
│   │   ├── datasourceService.ts
│   │   └── taskService.ts
│   │
│   ├── types/             # TypeScript 类型
│   │   └── index.ts
│   │
│   ├── utils/             # 工具函数
│   │   ├── format.ts
│   │   ├── echarts.ts
│   │   └── validators.ts
│   │
│   ├── styles/            # 样式
│   │   ├── globals.css
│   │   └── variables.css
│   │
│   └── constants/         # 常量
│       └── index.ts
│
├── public/                # 静态文件
│   └── assets/
│
├── __tests__/             # 测试
│   ├── components/
│   └── services/
│
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.example
└── README.md
```

## 启动指南

### 环境要求

- Node.js 24+
- npm 或 pnpm

### 本地开发

```bash
# 1. 进入前端目录
cd frontend

# 2. 安装依赖
npm install
# 或
pnpm install

# 3. 配置环境变量
cp .env.example .env.local

# 4. 启动开发服务器
npm run dev
```

访问 `http://localhost:3001`

### 生产构建

```bash
# 构建
npm run build

# 启动生产服务器
npm start
```

## 环境变量

### .env.local

```env
# API 地址
NEXT_PUBLIC_API_URL=http://localhost:3050/api

# 应用名称
NEXT_PUBLIC_APP_NAME=ChatBI

# 日志级别
NEXT_PUBLIC_LOG_LEVEL=info
```

## 核心页面

### Chat 页面 (src/pages/chat/)

对话界面，核心交互：

```
┌─────────────────────────────┐
│         Header              │ 顶部栏：应用名称、用户信息
├──────────┬──────────────────┤
│          │                  │
│ 会话列表 │   消息流展示     │ 左侧：历史对话列表
│          │   + SQL/图表     │ 右侧：消息流、SQL、图表
│          │                  │
│          ├──────────────────┤
│          │   输入框 + 发送  │ 底部：输入框和发送按钮
└──────────┴──────────────────┘
```

特性：
- 流式消息加载
- 展开 SQL 详情
- 查看执行结果
- 一键加入看板
- 一键创建定时任务

### 数据源管理 (src/pages/datasource/)

- 列表展示
- 新增/编辑数据源
- 连接测试
- Schema 预览

### 任务管理 (src/pages/task/)

- 任务列表（启用/禁用）
- 编辑 Cron 表达式
- 查看执行历史
- 手动触发

### 看板 (src/pages/dashboard/) [V1.0+]

- 拖拽编辑
- 卡片配置
- 筛选器支持
- 环比/同比开关

## 组件库

### 布局组件

```tsx
import { Layout } from '@/components/layout';

<Layout>
  <div>内容</div>
</Layout>
```

### 数据展示

```tsx
import { ChartRenderer } from '@/components/chart';
import { TableView } from '@/components/chart';

// ECharts 图表
<ChartRenderer config={chartConfig} />

// 表格
<TableView columns={columns} rows={data} />
```

### 对话组件

```tsx
import { ChatWindow } from '@/components/chat';
import { InputBox } from '@/components/chat';

<ChatWindow messages={messages} />
<InputBox onSend={handleSend} />
```

## API 集成

### Chat 服务

```typescript
import { chatService } from '@/services/chatService';

// 发送消息
const response = await chatService.sendMessage({
  conversationId: '...',
  message: '新产品昨天的订单数'
});

// 获取历史
const history = await chatService.getHistory('conversation_id');
```

### 数据源服务

```typescript
import { datasourceService } from '@/services/datasourceService';

// 列表
const datasources = await datasourceService.list();

// 创建
await datasourceService.create({
  name: '订单库',
  type: 'postgresql',
  config: {...}
});

// 测试连接
const result = await datasourceService.testConnection(config);
```

### 任务服务

```typescript
import { taskService } from '@/services/taskService';

// 列表
const tasks = await taskService.list();

// 创建
await taskService.create({
  name: '每日报告',
  cronExpression: '0 9 * * *',
  conversationId: '...'
});

// 执行
await taskService.execute('task_id');
```

## Hooks

### useChat

```typescript
import { useChat } from '@/hooks/useChat';

const {
  conversations,
  currentConversation,
  messages,
  loading,
  sendMessage,
  createConversation
} = useChat();
```

### useDatasource

```typescript
import { useDatasource } from '@/hooks/useDatasource';

const {
  datasources,
  loading,
  createDatasource,
  testConnection,
  deleteDatasource
} = useDatasource();
```

## 样式系统

### CSS 变量

```css
:root {
  --primary-color: #1890ff;
  --success-color: #52c41a;
  --error-color: #f5222d;
  --text-color: rgba(0, 0, 0, 0.85);
  --border-color: #d9d9d9;
  --background-color: #fafafa;
}
```

### Tailwind CSS（可选）

```html
<div class="flex justify-center items-center h-screen">
  <span class="text-lg font-bold">Loading...</span>
</div>
```

## ECharts 集成

```typescript
import { EChartsConfig } from '@/types';
import { generateLineChartConfig } from '@/utils/echarts';

const config: EChartsConfig = generateLineChartConfig(
  ['2024-01', '2024-02', '2024-03'],
  [100, 120, 140]
);
```

## 测试

```bash
# 运行测试
npm run test

# 观察模式
npm run test:watch

# 覆盖率
npm run test:coverage
```

## 部署

### Vercel 部署（推荐）

```bash
# 连接 Git 仓库
# 自动部署，无需额外配置
```

### Docker 部署

```bash
# 创建 Dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package*.json ./
RUN npm install --production
EXPOSE 3000
CMD ["npm", "start"]

# 构建镜像
docker build -t chatbi-frontend:latest .

# 运行容器
docker run -d -p 3001:3001 chatbi-frontend:latest
```

### 自托管（Nginx）

```nginx
server {
  listen 80;
  server_name yourdomain.com;

  location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## 性能优化

### 代码分割

Next.js 自动进行代码分割，无需额外配置。

### 图片优化

```tsx
import Image from 'next/image';

<Image
  src="/logo.svg"
  alt="Logo"
  width={200}
  height={200}
/>
```

### 懒加载

```tsx
import dynamic from 'next/dynamic';

const HeavyComponent = dynamic(() => import('@/components/Heavy'), {
  loading: () => <Loading />
});
```

## 浏览器支持

- Chrome (最新)
- Firefox (最新)
- Safari (最新)
- Edge (最新)

不支持 IE11

## 故障排查

### 无法连接到后端

1. 检查 `NEXT_PUBLIC_API_URL` 是否正确
2. 检查后端是否运行在 8000 端口
3. 检查防火墙和 CORS 配置

### 样式不显示

1. 清除 `.next` 目录
2. 重新安装依赖：`npm install`
3. 重启开发服务器

### 打包报错

1. 检查 TypeScript 错误：`npm run type-check`
2. 清除 `node_modules` 并重新安装
3. 检查依赖版本兼容性

## 扩展指南

### 添加新页面

```bash
# 在 src/pages/ 创建新文件
# Next.js 自动路由
src/pages/new-feature/index.tsx  →  /new-feature
```

### 添加新组件

```bash
# 在 src/components/ 创建新目录
mkdir src/components/my-component
touch src/components/my-component/MyComponent.tsx
touch src/components/my-component/index.ts
```

### 添加新 Hook

```typescript
// src/hooks/useMyHook.ts
export function useMyHook() {
  // Hook 逻辑
}
```

## 命令参考

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm start            # 启动生产服务器
npm run lint         # 代码检查
npm run type-check   # TypeScript 类型检查
npm test             # 运行测试
```

## 许可证

MIT

## 联系方式

- Issues: GitHub
- Docs: [设计文档](../README.md)

---

