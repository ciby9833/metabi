---
name: dispatcher-efficiency
version: 1.2.0
description: 派件员人效监控分析。当问题涉及派件、签收、派件员、站点、区域效率时使用。
match: "派件员 | dispatcher | 人效 | 准时签收 | 站点 | 区域"
priority: 100
datasourceTypes: [postgresql]
# 不再硬性白名单：dev 环境多表共存，Agent 需要能跨表查
# 生产建议加 tables: 列表锁死
# 用户问"为什么/差异/归因"类问题时，Agent 按以下维度逐个分组对比，找贡献最大的
attributableDimensions:
  - agent_area_name   # 区域
  - station_name      # 站点
  - is_signed_timely  # 是否准时
  - sign_type         # 签收类型
---

# 派件员人效监控分析

## 适用范围
**用我**：派件量、签收时效、派件员产能、站点对比、区域排行、分批派送率、异常签收等
**不用我**：财务、营收、订单金额、商品 SKU、退货等 → 用 general-data-query

## 核心数据源

| 表 | 说明 | 行数 | 时间范围 |
|---|---|---|---|
| `dwd.dispatcher_efficiency_detail` | **唯一数据源**。每行 = 一单一派件员的派送记录 | ~250 万 | 2026-05-17 ~ 2026-05-24（8 天 demo） |

## 字段语义（LLM 必读）

| 字段 | 类型 | 含义 | 陷阱与用法 |
|---|---|---|---|
| `waybill_no` | text | 运单号 | **同一运单可能有多次派送尝试**，算单量必须 `count(distinct waybill_no)` |
| `source_date` | date | 数据所属业务日 | **筛选时间用这个字段**，已建索引，效率高 |
| `agent_area_code` / `agent_area_name` | text | 区域 | 印尼地名，如 PKU=Pekanbaru, SUB=Surabaya, BDO=Bandung |
| `station_code` / `station_name` | text | 站点 | 一个区域有多个站点 |
| `dispatcher_id` / `dispatcher_name` | text | 派件员 | 名字可能重名，**唯一标识用 dispatcher_id** |
| `sign_type` | text | 签收类型 | 中文枚举：`正常签收` / `异常签收全部弃货` / `异常签收部分弃货` / ... |
| `is_signed_timely` | text | 是否准时签收 | **印尼语**：`Ya` = 准时，`Tidak` = 超时 |
| `is_split_delivery` | text | 是否分批派送 | 中文：`是` / `否` |
| `piece_count` | int | 单件件数 | 一单可有多件 |
| `billing_weight` | numeric | 计费重量（kg） | |
| `delivery_attempts` | int | 派送尝试次数 | 1 表示首次成交 |
| `dispatch_time` | timestamptz | 派送时间 | UTC |
| `actual_sign_time` | timestamptz | 实际签收时间 | UTC，可能为空（未签收）|
| `planned_sign_time` | timestamptz | 计划签收时间 | 用于判断是否超时 |
| `prev_node_drive_distance` | numeric | 上一节点驱车距离（km）| 衡量派送难度 |

## 业务术语词典（写 SQL 时遵循）

```
单量            =  count(distinct waybill_no)
派送行数        =  count(*)              -- 含重复派送
件数            =  sum(piece_count)
人效（单/人）   =  count(distinct waybill_no) / count(distinct dispatcher_id)
人效（件/人）   =  sum(piece_count)       / count(distinct dispatcher_id)
准时签收率      =  sum(case when is_signed_timely = 'Ya'  then 1 else 0 end) * 1.0 / count(*)
分批派送率      =  sum(case when is_split_delivery = '是' then 1 else 0 end) * 1.0 / count(*)
异常签收率      =  sum(case when sign_type LIKE '异常%'   then 1 else 0 end) * 1.0 / count(*)
首次签收率      =  sum(case when delivery_attempts = 1     then 1 else 0 end) * 1.0 / count(*)
平均派送时长(分) =  avg(extract(epoch from (actual_sign_time - dispatch_time)) / 60)
```

## 常见陷阱（看到必警觉）

1. **"单量"歧义**：用户说"单量"=去重运单数（22 万/天），**不是**导入行数（29 万/天）。
   - 如果用户问总数差异，**主动解释**：行数 ÷ 平均派送尝试次数 ≈ 单量。
2. **印尼语签收标志**：`is_signed_timely = 'Ya'` 是准时，**不要写 `= '是'`**。
3. **时区**：`dispatch_time` 是 UTC。如果用户问"晚上派送"等本地时间概念，用 `dispatch_time AT TIME ZONE 'Asia/Jakarta'`。
4. **零除**：算率类指标永远 `nullif(denominator, 0)` 兜底。
5. **NULL 签收时间**：`actual_sign_time IS NULL` 表示尚未签收，不要参与时效计算。
6. **数据时间范围有限**：只有 5/17 - 5/24。**用户问 6 月数据要主动告知没有**。

## 工作流（强制）

1. 看到派件相关问题 → **不要**直接写 SQL
2. 调一次 `sample_rows({table: 'dispatcher_efficiency_detail', n: 5})` 确认字段值（特别是枚举型字段当前的值是否还跟词典一致）
3. 用业务术语词典翻译用户意图
4. 写 SQL，强制：
   - 用 `source_date` 做时间过滤（已建索引）
   - schema 前缀写完整 `dwd.dispatcher_efficiency_detail`
   - 默认 `LIMIT 1000`
5. `run_sql({dry_run: true})` 验语法
6. `run_sql({dry_run: false})` 真跑
7. `finalize` 给最终 SQL + chart_type + 简短 narrative

## 图表推荐

| 问题形态 | 图表 |
|---|---|
| 按日期看单量趋势 | `line` |
| 按站点/区域排名 | `bar`（≤ 15）或 `table`（更多）|
| 时段分布 | `bar` 或 `heatmap` |
| 派件员 Top N | `table` |
| 准时率 vs 单量散点 | `scatter` |

## 关联指标（一起看更有意义）

业务上这些指标互相牵动，回答某个问题时如果数据明显支持，**主动**用 finalize 的 relatedHints 提醒用户：

| 主指标 | 关联指标 | 提示语示例 |
|---|---|---|
| **单量** ↑↑ | 准时签收率 | "量上去时签收时效容易掉，建议看下准时率" |
| **单量** 突变 | 派送尝试次数 | "可能伴随首次签收率下降" |
| **站点单量集中** | 派件员人均 | "Top 站点是不是靠堆人解决的？" |
| **区域单量差异大** | 异常签收率 | "高量区域是否质量也跟着下滑" |
| **新增派件员** ↑ | 平均派送尝试次数 | "新人通常多跑一次才能签收" |
| **是否分批派送** ↑ | 时效 | "分批通常拖时效" |

**关联提示 ≠ 下钻建议**：
- 下钻 (suggestedFollowUps) 是"我刚答完，自然下一个问题是 X"
- 关联 (relatedHints) 是"你可能没意识到 Y 跟你问的事相关，建议留意"

## 拒答的边界

如果用户问的是：
- 这张表里没有的字段（如收入、成本）→ 拒答，告诉用户这个 skill 不覆盖财务数据
- 时间范围在数据范围之外 → 拒答，说明数据只到 5/24
- "为什么"的归因类问题，单靠这张表答不全 → 给出能算的部分，老实说哪部分需要更多数据

## 行业基准
> 数据来源：手动维护的行业基准库。
> 用于"行业一般什么水平 / 标杆 / 对标"等问题。
> 通过 `cite_industry_benchmark` 工具拿到，**不要**让 LLM 凭训练知识胡报。

### 准时签收率
- 行业平均：**88% – 92%**
- 头部物流（顺丰/京东/极兔）：**93% – 96%**
- 区域型快递公司：**80% – 88%**
- 关键说明：促销期普遍下降 3-5 个百分点；雨季 / 极端天气下降 5-10 个点

### 平均派送时长（min，dispatch → sign）
- 城市核心区：**60 – 120 分钟**
- 城市非核心 / 郊区：**120 – 240 分钟**
- 县乡：**240 – 480 分钟**
- 异常派送（多次尝试 / 客户不在）：**> 24 小时**为正常

### 派件员人效（单 / 人 / 日）
- 都市核心区：**80 – 150 单 / 人 / 日**
- 一般城市：**60 – 100 单 / 人 / 日**
- 旺季峰值：**150 – 200 单 / 人 / 日**（再高通常预示着堆量、时效下降）

### 异常签收率
- 健康水位：**< 3%**
- 黄线：**3% – 6%**
- 红线：**> 6%**（需要立刻排查站点 / 派件员）

### 首次签收率（delivery_attempts = 1）
- 健康：**> 85%**
- 一般：**75% – 85%**
- 偏低：**< 75%**（多次派送说明客户不在 / 地址不准 / 派件路径不合理）

### 分批派送率
- 行业典型：**< 5%**，过高说明仓配协同有问题
