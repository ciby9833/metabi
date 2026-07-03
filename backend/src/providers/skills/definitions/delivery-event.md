---
name: delivery-event
version: 1.1.0
description: 派件履约事件分析。覆盖订单、平台、签收、派件耗时、网点、业务员等维度的运单级查询。
match: "订单 | 运单 | 平台 | 商家 | 来源 | 网点 | 业务员 | 快递员 | 签收 | 派件耗时 | 派件时长 | dispatch_to_sign | 履约 | 时效 | 派送时长"
priority: 90
datasourceTypes: [postgresql]
attributableDimensions:
  - order_source            # 平台/订单来源
  - dispatch_station_name   # 网点
  - sender_region           # 发件地区
  - receiver_region         # 收件地区
  - process_status          # 履约状态
---

# 派件履约事件分析

## 适用范围
**用我**：订单/运单/平台/网点/业务员/签收时效/派件履约相关问题
**不用我**：印尼派件员人效专题（→ dispatcher-efficiency）；财务营收（→ general-data-query）

## 核心数据源

| 表 | 说明 | 行数 | 时间范围 |
|---|---|---|---|
| `dwd.delivery_event_detail` | 派件事件明细。每行 = 一个运单的派件履约信息 | 4 GB 量级 | 取决于实际导入 |

## 关键字段语义

| 字段 | 含义 | 用法 |
|---|---|---|
| `waybill_no` | 运单号 | 单量 = `COUNT(DISTINCT waybill_no)` |
| `order_source` | 订单来源 / 平台 | shopee / TikTok / JFS / Tokopedia / Lazada ... |
| `dispatch_station_code/name` | 派件网点 | |
| `courier_code/name` | 业务员 | 一个网点多个业务员 |
| `dispatch_time` | 派件时间 | UTC，需要 `AT TIME ZONE` 转本地 |
| `sign_time` | 签收时间 | 未签收为 NULL |
| `has_dispatch` / `has_sign` | 派件/签收标志位（boolean） | 算签收率分子 |
| `dispatch_to_sign_minutes` | 派件到签收时长（分钟）| 算时效核心字段 |
| `arrival_to_sign_minutes` | 到件到签收时长 | |
| `is_cod` | 是否货到付款 | |
| `process_status` | 履约状态 | 字符串枚举，sample_rows 确认值 |
| `sender_region` / `receiver_region` | 发件/收件地区 | |

## 业务术语词典（核心指标）

```
单量             =  COUNT(DISTINCT waybill_no)
派件量           =  COUNT(DISTINCT CASE WHEN has_dispatch THEN waybill_no END)
签收量           =  COUNT(DISTINCT CASE WHEN has_sign THEN waybill_no END)
签收率           =  签收量 * 1.0 / nullif(单量, 0)
派件到签收率     =  签收量 * 1.0 / nullif(派件量, 0)
平均派件签收时长 =  AVG(dispatch_to_sign_minutes) FILTER (WHERE dispatch_to_sign_minutes IS NOT NULL AND dispatch_to_sign_minutes >= 0)
COD 占比         =  AVG(CASE WHEN is_cod THEN 1.0 ELSE 0 END)
```

## 常见陷阱

1. **签收率分母**：业务通常指**已派件单**，所以分母用 `COUNT(DISTINCT waybill_no WHERE has_dispatch)`，**不是全量 waybill**
2. **时长字段含 NULL**：未签收的 `dispatch_to_sign_minutes` 是 NULL，算 AVG 时记得 `FILTER (WHERE ... IS NOT NULL)`
3. **时长可能含极端值**：业务可能有 30 天的离群单，建议加 `WHERE dispatch_to_sign_minutes BETWEEN 0 AND 1440` 等合理边界
4. **时区**：`dispatch_time` / `sign_time` 都是 UTC，按天聚合用 `AT TIME ZONE '本地时区'`
5. **大表全表扫描成本**：4GB 表必须加时间窗口 WHERE，否则查询会很慢

## 关联指标（一起看更有意义）

| 主指标 | 关联指标 | 提示语 |
|---|---|---|
| 单量 ↑↑ | 签收率 / 平均时长 | "量上去后时效会不会跟着掉" |
| 某平台单量异常 | 该平台 COD 占比 | "新增需求是不是被 COD 推高的" |
| 某网点签收率低 | 该网点平均时长 | "时效拖累了签收" |
| 某地区单量集中 | 该地区业务员数 | "靠堆人解决的吗" |

## 工作流

1. 收到问题后**先用** `sample_rows(table='dwd.delivery_event_detail', n=5)` 看一下 `order_source` / `process_status` 的实际枚举值（数据可能随业务变）
2. 写 SQL 时遵循术语词典里的公式
3. 大表必须加时间过滤
4. 一次性成功后立刻 finalize

## 推荐图表

| 问题形态 | 图表 |
|---|---|
| 按时间看趋势 | line |
| 按平台/网点排名 | bar 或 table |
| 时长分布 | bar 直方图 |
| 多指标对比（单量 vs 签收率） | bar + 折线双轴 |

## 拒答边界

- 用户问印尼派件员人效专题 → 告诉用户用 dispatcher-efficiency skill
- 用户问财务营收 → 这张表不覆盖，建议换数据源

## 行业基准
> 数据来源：手动维护的行业基准库。
> 用户问"行业一般什么水平 / 标杆 / 对标"时，通过 `cite_industry_benchmark` 工具引用。

### 派件签收率（已签收 / 派出）
- 行业平均：**88% – 92%**
- 头部企业：**93% – 96%**
- 大促 / 雨季会下降 3-8 个点

### 派件耗时（小时，dispatch → sign）
- 同城：**< 6 小时**为优秀，6 – 24 小时为正常
- 跨省：**24 – 72 小时**为正常
- 偏远地区：**72 – 120 小时**为正常
- 超过 120 小时基本属于异常

### 单店 / 单平台日均订单
- 大商家：**> 5000 单 / 日**
- 中型：**500 – 5000**
- 小型：**< 500**

### COD（货到付款）占比
- 印尼电商行业典型：**15% – 30%**
- COD 占比 > 50% 说明客群下沉 / 风险更高

### 履约异常率（process_status != "正常签收"）
- 健康：**< 5%**
- 黄线：**5% – 10%**
- 红线：**> 10%**

### 退签 / 拒收率
- 行业典型：**1% – 3%**
- 服饰类目最高可达 **5% – 8%**（试穿不合身退）
