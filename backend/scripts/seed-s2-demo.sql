-- ============================================================
-- 场景 S2 demo 数据：新产品分时段单量监控
--
-- 数据集对应:
--   dwd.dwd_product            产品基础信息
--   dwd.dwd_order_hourly       订单小时级聚合（语义层 dwd_order_hourly）
--   dwd.dwd_waybill            运单事实表（语义层 dwd_waybill，简化版）
--
-- 包含近 14 天的数据，包含 3 个新产品 + 5 个老产品
-- 第 13 天（昨天）C 平台新产品 20-22 点单量明显下跌（异常波动）
-- ============================================================

CREATE SCHEMA IF NOT EXISTS dwd;

-- ============================================================
-- 1) 产品表
-- ============================================================
DROP TABLE IF EXISTS dwd.dwd_product CASCADE;
CREATE TABLE dwd.dwd_product (
  product_id       VARCHAR(32) PRIMARY KEY,
  product_name     VARCHAR(128) NOT NULL,
  category         VARCHAR(64),
  is_new_product   BOOLEAN NOT NULL DEFAULT false,
  launched_at      DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO dwd.dwd_product (product_id, product_name, category, is_new_product, launched_at) VALUES
  ('P001', '极速达-标准', '快递', false, '2025-01-15'),
  ('P002', '次日达-精选', '快递', false, '2025-03-20'),
  ('P003', '大件运输-华东', '物流', false, '2025-02-01'),
  ('P004', '冷链生鲜', '冷链',  false, '2025-04-10'),
  ('P005', '同城闪送', '即时',  false, '2025-05-01'),
  -- 新产品 (近 30 天内上线)
  ('P101', '云仓代发-小件', '云仓', true, CURRENT_DATE - INTERVAL '20 days'),
  ('P102', '县域加速派送', '快递', true, CURRENT_DATE - INTERVAL '10 days'),
  ('P103', '跨境直邮-东南亚', '跨境', true, CURRENT_DATE - INTERVAL '7 days');

-- ============================================================
-- 2) 小时订单聚合表（场景 S2 核心）
-- ============================================================
DROP TABLE IF EXISTS dwd.dwd_order_hourly CASCADE;
CREATE TABLE dwd.dwd_order_hourly (
  id              BIGSERIAL PRIMARY KEY,
  stat_hour       TIMESTAMPTZ NOT NULL,
  stat_date       DATE NOT NULL,
  hour_of_day     INT NOT NULL,
  product_id      VARCHAR(32) NOT NULL,
  product_name    VARCHAR(128),
  is_new_product  BOOLEAN NOT NULL DEFAULT false,
  platform_name   VARCHAR(32) NOT NULL,
  order_count     INT NOT NULL,
  gmv             NUMERIC(14, 2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_hourly_stat_hour ON dwd.dwd_order_hourly(stat_hour);
CREATE INDEX idx_order_hourly_product ON dwd.dwd_order_hourly(product_id);

-- 生成近 14 天的数据：14 天 × 24 小时 × 8 产品 × 3 平台
DO $$
DECLARE
  d_offset INT;
  h INT;
  prod RECORD;
  platform RECORD;
  base_count INT;
  hour_multiplier NUMERIC;
  platform_multiplier NUMERIC;
  noise NUMERIC;
  final_count INT;
  final_gmv NUMERIC;
  stat_ts TIMESTAMPTZ;
  is_yesterday_evening BOOLEAN;
  is_anomaly_product BOOLEAN;
BEGIN
  FOR d_offset IN 1..14 LOOP
    FOR h IN 0..23 LOOP
      stat_ts := date_trunc('hour', NOW()) - (d_offset || ' days')::INTERVAL + (h || ' hours')::INTERVAL - (date_part('hour', NOW()) || ' hours')::INTERVAL;
      -- 重新校正：以「d_offset 天前的 h 点」为锚
      stat_ts := date_trunc('day', NOW()) - (d_offset || ' days')::INTERVAL + (h || ' hours')::INTERVAL;

      -- 时段倍数（早高峰 9-11, 晚高峰 19-21 较高，凌晨较低）
      hour_multiplier := CASE
        WHEN h BETWEEN 0 AND 5 THEN 0.2
        WHEN h BETWEEN 6 AND 8 THEN 0.7
        WHEN h BETWEEN 9 AND 11 THEN 1.4
        WHEN h BETWEEN 12 AND 14 THEN 1.0
        WHEN h BETWEEN 15 AND 18 THEN 1.1
        WHEN h BETWEEN 19 AND 21 THEN 1.3
        ELSE 0.6
      END;

      FOR prod IN SELECT * FROM dwd.dwd_product LOOP
        FOR platform IN SELECT unnest(ARRAY['A平台', 'B平台', 'C平台']) AS name LOOP
          -- 平台权重
          platform_multiplier := CASE platform.name
            WHEN 'A平台' THEN 1.2
            WHEN 'B平台' THEN 0.9
            ELSE 0.7
          END;

          -- 产品基础量
          base_count := CASE
            WHEN prod.is_new_product THEN 30
            ELSE 100
          END;

          -- 异常注入：昨天（d_offset = 1）的 C 平台 + 新产品 P101，20-22 点单量下跌 60%
          is_anomaly_product := prod.product_id = 'P101' AND platform.name = 'C平台';
          is_yesterday_evening := d_offset = 1 AND h BETWEEN 20 AND 22;

          -- 加入随机噪声 ±15%
          noise := 0.85 + random() * 0.30;

          final_count := GREATEST(
            0,
            ROUND(base_count * hour_multiplier * platform_multiplier * noise)
          );
          IF is_anomaly_product AND is_yesterday_evening THEN
            final_count := ROUND(final_count * 0.4);  -- 下跌 60%
          END IF;

          final_gmv := final_count * (8 + random() * 12); -- 单价 8-20

          INSERT INTO dwd.dwd_order_hourly (
            stat_hour, stat_date, hour_of_day, product_id, product_name,
            is_new_product, platform_name, order_count, gmv
          ) VALUES (
            stat_ts, stat_ts::DATE, h, prod.product_id, prod.product_name,
            prod.is_new_product, platform.name, final_count, final_gmv
          );
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 3) 简化运单事实表（场景 S1 备用）
-- ============================================================
DROP TABLE IF EXISTS dwd.dwd_waybill CASCADE;
CREATE TABLE dwd.dwd_waybill (
  waybill_no       VARCHAR(40) PRIMARY KEY,
  order_no         VARCHAR(40),
  product_id       VARCHAR(32),
  platform_code    VARCHAR(8),
  platform_name    VARCHAR(32),
  weight_band      VARCHAR(16),
  flow_direction   VARCHAR(64),
  ship_hour        INT,
  ship_date        DATE,
  ship_time        TIMESTAMPTZ,
  actual_fee       NUMERIC(10, 2),
  cost             NUMERIC(10, 2)
);

-- 从 hourly 表生成 sample waybill（每 hourly 行生成 1-3 条 waybill）
INSERT INTO dwd.dwd_waybill (
  waybill_no, order_no, product_id, platform_code, platform_name,
  weight_band, flow_direction, ship_hour, ship_date, ship_time,
  actual_fee, cost
)
SELECT
  'W' || LPAD((row_number() OVER ())::TEXT, 10, '0'),
  'O' || LPAD((row_number() OVER ())::TEXT, 10, '0'),
  product_id,
  CASE platform_name WHEN 'A平台' THEN 'A' WHEN 'B平台' THEN 'B' ELSE 'C' END,
  platform_name,
  (ARRAY['0-3kg', '3-10kg', '10kg+'])[1 + (random() * 2.99)::INT],
  (ARRAY['华东->华南', '华北->华东', '华南->西南', '华东->华北'])[1 + (random() * 3.99)::INT],
  hour_of_day,
  stat_date,
  stat_hour,
  ROUND((8 + random() * 12)::NUMERIC, 2),
  ROUND((5 + random() * 8)::NUMERIC, 2)
FROM dwd.dwd_order_hourly
WHERE random() < 0.3 -- 只采样 30%，避免数据过大
LIMIT 5000;

-- ============================================================
-- 4) 总结
-- ============================================================
SELECT
  'dwd_product' AS table_name, COUNT(*) AS row_count FROM dwd.dwd_product
UNION ALL SELECT 'dwd_order_hourly', COUNT(*) FROM dwd.dwd_order_hourly
UNION ALL SELECT 'dwd_waybill', COUNT(*) FROM dwd.dwd_waybill;
