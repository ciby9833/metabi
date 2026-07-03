/**
 * Dataset 模式 Eval 任务集 — 真实自助分析场景
 *
 * 设计：
 *   - 数据 inline（CSV string），避免外部依赖
 *   - 期望基于"可验证的事实"（数字、关键词），不靠 LLM 评分
 *   - 覆盖关键失败模式：列描述不足、JOIN、空表、中文术语、大整数等
 *   - 每个 task 应在 < 30s / < 6 步 / < 30K tokens 完成（dataset 模式核心承诺）
 */
import { EvalTask, EvalSetup } from '../types';

// 共用 CSV 数据 ----------------------------------------------------

const CUSTOMERS_CSV = `cust_id,name,city
201563866322,张三,北京
201563866323,李四,上海
201563866324,王五,广州
201563866325,赵六,深圳
201563866326,孙七,北京
`;

const ORDERS_CSV = `order_id,cust_id,amount,order_date
1001,201563866322,150,2026-05-10
1002,201563866322,200,2026-05-12
1003,201563866323,300,2026-05-11
1004,201563866324,100,2026-05-15
1005,201563866325,500,2026-05-20
1006,201563866322,80,2026-05-22
1007,201563866326,250,2026-05-25
1008,201563866325,180,2026-05-28
`;

const SALES_DAILY_CSV = `date,revenue,orders
2026-05-01,12000,45
2026-05-02,13500,52
2026-05-03,11800,48
2026-05-04,9500,38
2026-05-05,15000,60
2026-05-06,18000,72
2026-05-07,16500,65
`;

// Setup 模板 ------------------------------------------------------

export const customersOrdersSetup = (): EvalSetup => ({
  mode: 'dataset' as const,
  datasets: [
    {
      name: '客户表',
      description: '客户基本信息',
      csv: CUSTOMERS_CSV,
      columnDescriptions: {
        cust_id: '客户ID（主键）',
        name: '客户姓名',
        city: '所在城市',
      },
    },
    {
      name: '订单表',
      description: '客户订单流水',
      csv: ORDERS_CSV,
      columnDescriptions: {
        order_id: '订单ID（主键）',
        cust_id: '客户ID（关联客户表.cust_id）',
        amount: '订单金额',
        order_date: '下单日期',
      },
    },
  ],
});

const salesDailySetup = (): EvalSetup => ({
  mode: 'dataset' as const,
  datasets: [
    {
      name: '日销售',
      description: '每日营收和订单数',
      csv: SALES_DAILY_CSV,
      columnDescriptions: {
        date: '日期',
        revenue: '日营收（元）',
        orders: '订单数',
      },
    },
  ],
});

// =============== TASKS ===============

export const DATASET_MODE_TASKS: EvalTask[] = [
  // ---------- 简单聚合 ----------
  {
    id: 'ds-agg-001',
    category: 'dataset_simple_agg',
    description: '订单总金额（单表 SUM）',
    setup: customersOrdersSetup(),
    question: '订单总金额是多少？',
    expected: {
      shouldNotRefuse: true,
      shouldHaveSqlResult: true,
      // 1760
      mustContainNumbers: [1760],
      mustNotContain: ['抱歉', '拒答'],
      maxSteps: 6,
      maxTokens: 40000,
      toolsMustNotUse: ['list_tables', 'search_tables', 'describe_table'],
    },
  },
  {
    id: 'ds-agg-002',
    category: 'dataset_simple_agg',
    description: '订单平均金额（LLM 倾向多角度验算，放宽 token 限制）',
    setup: customersOrdersSetup(),
    question: '每单平均金额？',
    expected: {
      shouldNotRefuse: true,
      // 220
      mustContainNumbers: [220],
      maxSteps: 8,
      maxTokens: 55000,
    },
  },
  {
    id: 'ds-agg-003',
    category: 'dataset_simple_agg',
    description: '客户数 COUNT DISTINCT',
    setup: customersOrdersSetup(),
    question: '一共有多少个不同的客户下过单？',
    expected: {
      shouldNotRefuse: true,
      // 5 (Alice, Bob, Charlie, David, Eve - 5 unique)
      mustContainNumbers: [5],
      maxSteps: 6,
    },
  },

  // ---------- 多表 JOIN ----------
  {
    id: 'ds-join-001',
    category: 'dataset_multi_table_join',
    description: '按城市汇总订单金额（必须 JOIN）',
    setup: customersOrdersSetup(),
    question: '哪个城市的客户下单总金额最高？',
    expected: {
      shouldNotRefuse: true,
      shouldHaveSqlResult: true,
      // 深圳 680 (500+180)，北京 680 (150+200+80+250) — 实际：北京 (Alice 430 + Eve 250 = 680)，深圳 680
      // 实际：北京=Alice 430 + Eve 250=680；深圳=赵六 500+180=680；并列
      // 让 LLM 给出某个城市 + 包含数字 680
      mustContain: ['北京'], // 应该包含某个最大值城市
      mustContainNumbers: [680],
      sqlMustContainJoin: true,
      maxSteps: 6,
    },
  },
  {
    id: 'ds-join-002',
    category: 'dataset_multi_table_join',
    description: '客户姓名 + 下单次数（需 JOIN + GROUP BY）',
    setup: customersOrdersSetup(),
    question: '每个客户下了几单？请按下单次数排序',
    expected: {
      shouldNotRefuse: true,
      // 张三 3 单（1001,1002,1006）
      mustContainNumbers: [3],
      mustContain: ['张三'],
      sqlMustContainJoin: true,
      maxSteps: 6,
    },
  },

  // ---------- TOP N ----------
  {
    id: 'ds-top-001',
    category: 'dataset_top_n',
    description: 'TOP 1 最大单笔订单',
    setup: customersOrdersSetup(),
    question: '金额最大的一单是多少？是哪个客户下的？',
    expected: {
      shouldNotRefuse: true,
      // 1005, 500, 赵六
      mustContainNumbers: [500],
      mustContain: ['赵六'],
      sqlMustContainJoin: true,
      maxSteps: 6,
    },
  },

  // ---------- 时间序列 ----------
  {
    id: 'ds-time-001',
    category: 'dataset_time_series',
    description: '5月7日营收（单点时间过滤）',
    setup: salesDailySetup(),
    question: '5月7日的营收是多少？',
    expected: {
      shouldNotRefuse: true,
      mustContainNumbers: [16500],
      maxSteps: 6,
    },
  },
  {
    id: 'ds-time-002',
    category: 'dataset_time_series',
    description: '指定明确时间范围的总营收（避开"这一周"的歧义）',
    setup: salesDailySetup(),
    question: '5月1日到5月7日的总营收是多少？',
    expected: {
      shouldNotRefuse: true,
      // 12000+13500+11800+9500+15000+18000+16500=96300
      mustContainNumbers: [96300],
      maxSteps: 6,
    },
  },
  {
    id: 'ds-time-003',
    category: 'dataset_time_series',
    description: '日营收最高的一天',
    setup: salesDailySetup(),
    question: '哪天营收最高？',
    expected: {
      shouldNotRefuse: true,
      mustContainNumbers: [18000], // 自动匹配千分位 / 万单位变体
      maxSteps: 6,
    },
  },

  // ---------- 比例 / 占比 ----------
  {
    id: 'ds-ratio-001',
    category: 'dataset_ratio',
    description: '北京客户占比（COUNT + 百分比）',
    setup: customersOrdersSetup(),
    question: '北京客户占所有客户的百分比？',
    expected: {
      shouldNotRefuse: true,
      // 2/5 = 40%
      mustContain: ['40'],
      maxSteps: 6,
    },
  },

  // ---------- 探查（meta question） ----------
  {
    id: 'ds-explore-001',
    category: 'dataset_exploration',
    description: '问"有什么数据" — LLM 不应启动 SQL 探查，直接答',
    setup: customersOrdersSetup(),
    question: '当前有哪些表？分别有什么字段？',
    expected: {
      shouldNotRefuse: true,
      // 关键字宽松：含"客户"和"订单"即可（LLM 可能用"客户信息表"等扩展名）
      mustContain: ['客户', '订单'],
      maxSteps: 4,
      maxTokens: 25000,
      // 关键：不应该调元数据探索工具（schema 已在 prompt）
      toolsMustNotUse: ['list_tables', 'search_tables', 'describe_table'],
    },
  },

  // ---------- 中文术语 ----------
  {
    id: 'ds-chinese-001',
    category: 'dataset_chinese_term',
    description: '"下单量" → 应理解为订单数',
    setup: customersOrdersSetup(),
    question: '总下单量是多少？',
    expected: {
      shouldNotRefuse: true,
      mustContainNumbers: [8], // 8 单
      maxSteps: 6,
    },
  },
  {
    id: 'ds-chinese-002',
    category: 'dataset_chinese_term',
    description: '"客单价" — 业务术语理解（不强制 JOIN，COUNT DISTINCT 即可）',
    setup: customersOrdersSetup(),
    question: '客单价是多少？',
    expected: {
      shouldNotRefuse: true,
      // 1760 / 5 = 352（订单表本身就有 cust_id 不必 JOIN customers）
      mustContainNumbers: [352],
      maxSteps: 6,
    },
  },

  // ---------- 边缘 case ----------
  {
    id: 'ds-edge-001',
    category: 'dataset_edge_case',
    description: '大整数 cust_id 不应被错推断 integer / 不应丢精度',
    setup: customersOrdersSetup(),
    question: '客户 ID 为 201563866322 的姓名是什么？',
    expected: {
      shouldNotRefuse: true,
      mustContain: ['张三'],
      maxSteps: 6,
    },
  },
  {
    id: 'ds-edge-002',
    category: 'dataset_edge_case',
    description: '空结果集 — 不存在的城市查询',
    setup: customersOrdersSetup(),
    question: '杭州的客户有多少？',
    expected: {
      shouldNotRefuse: true,
      // OR 语义：narrative 写"没有杭州客户" / "0 位客户" / "数量为 0" 任一即视为正确
      mustContainAny: ['没有', '0 位', '0 个', '数量为 0', '为 0'],
      mustNotContain: ['抱歉', '无法查询', '不存在的数据'],
      maxSteps: 6,
    },
  },
];
