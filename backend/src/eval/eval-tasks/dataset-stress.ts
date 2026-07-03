/**
 * Stress 测试集 — 故意构造能挑战 LLM 的真实场景。
 *
 * 设计原则：「Give the model context, test its judgment」
 *   - 不"控制" LLM 怎么答；构造场景测它对齐 context 的能力
 *   - 这里的 task 故意有歧义/陷阱/隐性 JOIN —— Verifier 应该捕获并要求返工
 *   - 目标：retry rate 20%+，且 retry 后通过率 > 60%（说明 Verifier 反馈真可行动）
 *
 * 失败模式分类：
 *   1. 列名陷阱 — 多个相似列，LLM 容易选错
 *   2. JOIN 隐性 — 关联字段命名不一致
 *   3. 业务术语多义 — 不止一种合理解读
 *   4. 数据陷阱 — outlier / null / 格式不一
 *   5. 用户问法模糊 — 但有"最合理默认值"
 */
import { EvalTask, EvalSetup } from '../types';
import { customersOrdersSetup } from './dataset-mode';

// ============ 数据资产 ============

/** 列名陷阱：amount vs gross_amount vs net_amount 容易混淆 */
const SALES_TRICKY_CSV = `order_id,customer,amount,gross_amount,net_amount,discount,refund_amount
1001,Alice,150,200,135,50,0
1002,Bob,300,300,285,0,15
1003,Charlie,250,280,225,30,25
1004,Alice,500,550,500,50,0
1005,David,100,100,80,0,20
1006,Bob,400,450,400,50,0
1007,Eve,200,200,180,0,20
1008,Charlie,350,400,350,50,0
`;

/** JOIN 隐性：客户表用 cid 而非 cust_id；产品表用 pid */
const ORDERS_CRYPTIC_CSV = `order_no,cid,pid,qty,total
o1001,c01,p01,2,200
o1002,c02,p02,1,500
o1003,c01,p03,3,150
o1004,c03,p01,1,100
o1005,c02,p02,2,1000
o1006,c01,p02,1,500
`;
const CUSTOMERS_CRYPTIC_CSV = `cid,customer_name,vip_level
c01,张三,gold
c02,李四,platinum
c03,王五,silver
c04,赵六,gold
`;
const PRODUCTS_CRYPTIC_CSV = `pid,product_name,category
p01,iPhone 套餐,数码
p02,MacBook,数码
p03,鼠标,配件
p04,键盘,配件
`;

/** outlier + null：营收有几天异常高/低，含 null */
const SALES_WITH_OUTLIER_CSV = `date,revenue,orders,channel
2026-05-01,12000,45,online
2026-05-02,13500,52,online
2026-05-03,11800,48,online
2026-05-04,9500,38,
2026-05-05,15000,60,store
2026-05-06,180000,72,online
2026-05-07,16500,65,online
2026-05-08,,55,online
2026-05-09,14200,58,store
2026-05-10,13800,53,online
`;

/** 营销 ROI：花费 vs 收入 */
const MARKETING_CSV = `campaign,channel,spend,impressions,clicks,conversions,revenue
C001,Google,5000,100000,3000,150,15000
C002,Meta,3000,80000,2000,100,8000
C003,TikTok,4000,150000,5000,80,9600
C004,Email,500,20000,1500,200,12000
C005,Display,2000,200000,1000,30,3000
`;

// ============ Setup helpers ============

const trickySalesSetup = (): EvalSetup => ({
  mode: 'dataset',
  datasets: [
    {
      name: '销售订单',
      description: '订单流水 — 含原价、折扣、退款 等多个金额字段',
      csv: SALES_TRICKY_CSV,
      columnDescriptions: {
        order_id: '订单ID',
        customer: '客户名',
        amount: '实付金额（用户实际支付）',
        gross_amount: '原价（折扣前）',
        net_amount: '净额（扣除退款）= amount - refund_amount',
        discount: '折扣金额',
        refund_amount: '退款金额',
      },
    },
  ],
});

const crypticJoinSetup = (): EvalSetup => ({
  mode: 'dataset',
  datasets: [
    {
      name: '订单',
      description: '订单表（cid=客户ID，pid=产品ID）',
      csv: ORDERS_CRYPTIC_CSV,
      columnDescriptions: {
        order_no: '订单编号',
        cid: '客户ID（关联客户表 cid）',
        pid: '产品ID（关联产品表 pid）',
        qty: '数量',
        total: '订单金额',
      },
    },
    {
      name: '客户',
      description: '客户基本资料',
      csv: CUSTOMERS_CRYPTIC_CSV,
      columnDescriptions: {
        cid: '客户ID（主键）',
        customer_name: '客户姓名',
        vip_level: 'VIP 等级（gold/platinum/silver）',
      },
    },
    {
      name: '产品',
      description: '产品目录',
      csv: PRODUCTS_CRYPTIC_CSV,
      columnDescriptions: {
        pid: '产品ID（主键）',
        product_name: '产品名',
        category: '品类',
      },
    },
  ],
});

const outlierSetup = (): EvalSetup => ({
  mode: 'dataset',
  datasets: [
    {
      name: '日销售',
      description: '每日营收（含异常值和缺失）',
      csv: SALES_WITH_OUTLIER_CSV,
      columnDescriptions: {
        date: '日期',
        revenue: '日营收（元）',
        orders: '订单数',
        channel: '渠道（online/store，可为空）',
      },
    },
  ],
});

const marketingSetup = (): EvalSetup => ({
  mode: 'dataset',
  datasets: [
    {
      name: '营销活动',
      description: '各 campaign 投放数据',
      csv: MARKETING_CSV,
      columnDescriptions: {
        campaign: '活动ID',
        channel: '渠道',
        spend: '花费',
        impressions: '曝光',
        clicks: '点击',
        conversions: '转化数',
        revenue: '带来的收入',
      },
    },
  ],
});

// ============ Tasks ============

export const DATASET_STRESS_TASKS: EvalTask[] = [
  // ---------- 列名陷阱 ----------
  {
    id: 'stress-col-001',
    category: 'dataset_simple_agg',
    description: '"实际营收" — 应该用 amount 而非 gross_amount',
    setup: trickySalesSetup(),
    question: '所有订单的实际营收（用户实付）总和是多少？',
    expected: {
      shouldNotRefuse: true,
      // amount: 150+300+250+500+100+400+200+350 = 2250
      // gross_amount: 200+300+280+550+100+450+200+400 = 2480
      // 正确答案 2250；如果 LLM 用错列会算成 2480
      mustContainNumbers: [2250],
      mustNotContain: ['2480'], // 用错列就会出现这数字
      maxSteps: 6,
      maxTokens: 50000,
    },
  },
  {
    id: 'stress-col-002',
    category: 'dataset_simple_agg',
    description: '"实际收到的钱" — 接受 net_amount(2155) 或 amount-refund(2170) 两种合理推理',
    setup: trickySalesSetup(),
    question: '考虑退款后，公司实际收到的总金额是多少？',
    expected: {
      shouldNotRefuse: true,
      // 2155 = SUM(net_amount); 2170 = SUM(amount-refund_amount); 两种都对
      mustContainAny: ['2155', '2,155', '2170', '2,170'],
      maxSteps: 6,
      maxTokens: 60000,
    },
  },

  // ---------- JOIN 隐性 ----------
  {
    id: 'stress-join-001',
    category: 'dataset_multi_table_join',
    description: '客户姓名按金额排序（cid 字段不直观，需推理关联）',
    setup: crypticJoinSetup(),
    question: '消费总金额最高的客户姓名是什么？',
    expected: {
      shouldNotRefuse: true,
      // cid=c02 李四: 500+1000=1500（最大）
      mustContain: ['李四'],
      mustContainNumbers: [1500],
      sqlMustContainJoin: true,
      maxSteps: 6,
    },
  },
  {
    id: 'stress-join-002',
    category: 'dataset_multi_table_join',
    description: '3 表 JOIN：客户姓名+产品类别+销售金额',
    setup: crypticJoinSetup(),
    question: '哪个品类卖得最多（按金额）？是哪些客户买的？',
    expected: {
      shouldNotRefuse: true,
      // p01+p02 都是数码；p03 配件
      // 数码: 200+500+100+1000+500 = 2300（c01,c02,c03 都买）
      // 配件: 150
      mustContain: ['数码'],
      sqlMustContainJoin: true,
      maxSteps: 7,
      maxTokens: 60000,
    },
  },

  // ---------- 数据陷阱 ----------
  {
    id: 'stress-outlier-001',
    category: 'dataset_simple_agg',
    description: 'outlier 识别 — 5/6 营收 180000 明显异常（已知 LLM 能力局限，放宽 max）',
    setup: outlierSetup(),
    question: '本期日均营收是多少？有没有什么数据异常需要注意？',
    expected: {
      shouldNotRefuse: true,
      // 平均值 OR 异常关键词任一即过（要么算对均值，要么识别异常）
      mustContainAny: ['异常', 'outlier', '5月6日', '180,000', '180000', '高于', '明显', '13800', '13,800', '13290', '13,290'],
      maxSteps: 8,
      maxTokens: 90000,
    },
  },
  {
    id: 'stress-null-001',
    category: 'dataset_edge_case',
    description: 'null 处理 — channel 列有 1 个 null，统计需正确处理',
    setup: outlierSetup(),
    question: 'online 渠道的总订单数是多少？',
    expected: {
      shouldNotRefuse: true,
      // online: 45+52+48+72+65+55+53 = 390
      mustContainNumbers: [390],
      maxSteps: 6,
    },
  },

  // ---------- 业务术语 ----------
  {
    id: 'stress-term-001',
    category: 'dataset_chinese_term',
    description: 'ROI 业务术语 — 接受两种合理定义（倍数 vs 净增长率）',
    setup: marketingSetup(),
    question: '哪个 campaign 的 ROI 最高？',
    expected: {
      shouldNotRefuse: true,
      // C004 一定是答案，无论哪种 ROI 定义
      mustContain: ['C004'],
      // 24 = revenue/spend (倍数);  23 = (rev-spend)/spend (净增长率); 2300%/2400% 也算
      mustContainAny: ['24', '23', '2300', '2400'],
      maxSteps: 6,
    },
  },
  {
    id: 'stress-term-002',
    category: 'dataset_chinese_term',
    description: 'CTR + 转化率组合',
    setup: marketingSetup(),
    question: 'Google 渠道的点击率和转化率分别是多少？',
    expected: {
      shouldNotRefuse: true,
      // CTR = clicks/impressions = 3000/100000 = 3%
      // CVR = conversions/clicks = 150/3000 = 5%
      mustContainAny: ['3%', '0.03', '3.00'],
      maxSteps: 6,
    },
  },

  // ---------- 文件导出 ----------
  {
    id: 'stress-export-001',
    category: 'dataset_simple_agg',
    description: '用户明确说"导出 Excel" — 应调 export_table 工具',
    setup: customersOrdersSetup(),
    question: '帮我把所有客户的姓名和城市导出成 Excel',
    expected: {
      shouldNotRefuse: true,
      // 必须调 export_table 工具
      toolsMustUse: ['export_table'],
      // narrative 应说"已生成"或"已导出"
      mustContainAny: ['已生成', '已导出', '附件', 'Excel', '.xlsx'],
      maxSteps: 6,
      maxTokens: 50000,
    },
  },

  // ==================================================
  // Verifier-stress：故意让 LLM 容易答错的场景，验 Verifier 抓错能力
  // ==================================================

  {
    id: 'vrf-stress-001',
    category: 'dataset_multi_table_join',
    description: '需要 SUBQUERY 的隐式对比 — LLM 常写扁平 SQL 遗漏对比逻辑',
    setup: trickySalesSetup(),
    question: '哪些订单的退款金额超过了平均退款？金额是多少？',
    expected: {
      shouldNotRefuse: true,
      // 平均退款 = (0+15+25+0+20+0+20+0)/8 = 10
      // 超过 10 的：15(1002), 25(1003), 20(1005), 20(1007) — 4 个
      // 关键是 SQL 必须用 SUBQUERY 或 WINDOW 算平均
      mustContainAny: ['1002', '1003', '1005', '1007', 'Bob', 'Charlie', 'David', 'Eve'],
      // 平均退款 10
      mustContainNumbers: [10],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  {
    id: 'vrf-stress-002',
    category: 'dataset_multi_table_join',
    description: 'CASE WHEN 分类 — LLM 常漏 edge case（0 边界、null）',
    setup: trickySalesSetup(),
    question:
      '把订单按折扣情况分成"有折扣"和"无折扣"两类，各自的订单数和平均金额是多少？',
    expected: {
      shouldNotRefuse: true,
      // 有折扣（discount>0）：1001,1003,1004,1006,1008 = 5 单
      // 无折扣：1002,1005,1007 = 3 单
      mustContainNumbers: [5, 3],
      mustContain: ['折扣'],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  {
    id: 'vrf-stress-003',
    category: 'dataset_simple_agg',
    description: '时间窗口边界 — LLM 常忽略"含不含今天"',
    setup: outlierSetup(),
    question: '5月4日到5月6日（含首尾）的总营收是多少？',
    expected: {
      shouldNotRefuse: true,
      // 5/4=9500 + 5/5=15000 + 5/6=180000 = 204500
      mustContainNumbers: [204500],
      sqlMustReferenceTable: ['user_data.'],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  {
    id: 'vrf-stress-004',
    category: 'dataset_ratio',
    description: '需要 ROLLUP 或 UNION — 整体汇总 + 分组同时给',
    setup: marketingSetup(),
    question: '按渠道分组显示营收，同时给出所有渠道的总营收',
    expected: {
      shouldNotRefuse: true,
      // 总: 15000+8000+9600+12000+3000 = 47600
      // Google 15000; Meta 8000; TikTok 9600; Email 12000; Display 3000
      mustContainNumbers: [47600],
      mustContain: ['Google', 'Email'],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  {
    id: 'vrf-stress-005',
    category: 'dataset_edge_case',
    description: '答非所问陷阱 — LLM 常给相关但错答（问 A 答 B）',
    setup: trickySalesSetup(),
    question: 'Alice 一共下了几单，平均每单实付多少？',
    expected: {
      shouldNotRefuse: true,
      // Alice: 1001(150) + 1004(500) = 2 单，平均 (150+500)/2 = 325
      mustContainNumbers: [2, 325],
      mustContain: ['Alice'],
      // 不该混入其他客户信息
      mustNotContain: ['Charlie', 'Bob'],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  // ---------- PDF 导出 ----------
  {
    id: 'stress-export-pdf-001',
    category: 'dataset_simple_agg',
    description: '用户明确说"导出 PDF" — 应调 export_table 用 format=pdf',
    setup: customersOrdersSetup(),
    question: '把所有客户和城市做成 PDF 报告发我',
    expected: {
      shouldNotRefuse: true,
      toolsMustUse: ['export_table'],
      mustContainAny: ['PDF', '.pdf', '已生成', '已导出', '附件'],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  // ---------- @ 字段联想（前端 Mentions 触发）----------
  {
    id: 'mention-001',
    category: 'dataset_simple_agg',
    description: '用户用 @字段 明确指定分析维度 — 应严格围绕该字段展开',
    setup: trickySalesSetup(),
    question: '按 @customer 分组显示 @amount 的合计',
    expected: {
      shouldNotRefuse: true,
      // Alice: 150+500=650; Bob: 300+400=700; Charlie: 250+350=600; David 100; Eve 200
      mustContain: ['Alice', 'Bob'],
      mustContainNumbers: [700, 650],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },

  // ---------- 用户问法模糊但有合理默认 ----------
  {
    id: 'stress-vague-001',
    category: 'dataset_exploration',
    description: '"分析下这份数据" — 极其模糊但应给出整体洞察',
    setup: marketingSetup(),
    question: '帮我看下这份营销数据，有什么发现？',
    expected: {
      shouldNotRefuse: true,
      // 应该至少提到：渠道数 / 总花费 / 总收入 / ROI 高低 / 关键发现
      mustContainAny: ['ROI', '转化', '收入', 'C004', 'Email', '花费'],
      maxSteps: 6,
      maxTokens: 55000,
    },
  },
];
