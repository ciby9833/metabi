-- ============================================================
-- 系统管理员 seed
-- 邮箱: noelgfr@gmail.com
-- 密码: xiaotao4vip
--
-- 使用方法（在 backend 容器启动并完成 TypeORM 建表后执行）：
--   PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -p $DATABASE_PORT \
--     -U $DATABASE_USER -d $DATABASE_NAME -f scripts/seed-admin.sql
--
-- 也可以在 backend/scripts 下跑 npm run seed:admin（见 package.json）。
-- ============================================================

DO $$
BEGIN
  IF to_regclass('app.users') IS NULL THEN
    RAISE NOTICE 'app.users not exist yet — start backend first to let TypeORM create it.';
    RETURN;
  END IF;

  -- bcrypt 哈希（$2b$10$...） of "xiaotao4vip"
  INSERT INTO app.users (
    id, email, name, password_hash,
    email_verified_at, is_admin, is_active,
    created_at, updated_at
  )
  VALUES (
    gen_random_uuid(),
    'noelgfr@gmail.com',
    '系统管理员',
    '$2b$10$4lt5MzP9HFO9nef1WQpXj.qlnRNI8DZcMlxVvCoWRT024ZDoJ8n62',
    NOW(),
    true,
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (email) DO UPDATE SET
    is_admin = EXCLUDED.is_admin,
    is_active = EXCLUDED.is_active,
    email_verified_at = COALESCE(app.users.email_verified_at, EXCLUDED.email_verified_at),
    -- 不覆盖已存在用户的密码（避免一不小心把生产改回默认密码）
    name = COALESCE(app.users.name, EXCLUDED.name);

  RAISE NOTICE 'Admin user seeded: noelgfr@gmail.com';
END $$;
