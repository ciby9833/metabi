FROM node:24-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 生产镜像
FROM node:24-alpine

WORKDIR /app

# 安装只需要的依赖
COPY package*.json ./
RUN npm ci --only=production

# 从构建镜像复制编译后的代码
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
