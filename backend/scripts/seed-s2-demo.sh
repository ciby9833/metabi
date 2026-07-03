#!/bin/bash
set -e

# 将 S2 demo 数据导入到 PostgreSQL
# 使用方法：bash scripts/seed-s2-demo.sh

cd "$(dirname "$0")/.."

# 加载 .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

DB_HOST=${DATABASE_HOST:-localhost}
DB_PORT=${DATABASE_PORT:-5432}
DB_USER=${DATABASE_USER:-chatbi_user}
DB_NAME=${DATABASE_NAME:-chatbi_db}
DB_PASSWORD=${DATABASE_PASSWORD:-chatbi_password}

echo "📦 Seeding S2 demo data to ${DB_HOST}:${DB_PORT}/${DB_NAME}..."

PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -f scripts/seed-s2-demo.sql

echo "✅ S2 demo data loaded."
echo ""
echo "🎯 你现在可以试试这些问题（在 ChatBI 对话框中）："
echo "   1. 昨天每小时的订单数（按产品分组）"
echo "   2. 新产品近 7 天的单量趋势"
echo "   3. C 平台新产品 P101 昨天晚上的单量是否异常"
echo "   4. 各平台今天的 GMV 对比"
