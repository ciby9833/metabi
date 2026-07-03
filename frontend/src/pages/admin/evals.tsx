/**
 * /admin/evals — Eval Runs 历史 dashboard（仅 admin）
 *
 * Anatoli 说的 "cost per accepted change" 时序追踪：每次 prompt/工具改动
 * 后跑一次 eval，dashboard 显示趋势 — 让优化决策评估驱动，非凭感觉。
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Layout,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BarChartOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  LineChartOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { evalService, EvalRunSummary, EvalRunDetail } from '@/services';
import { authStorage } from '@/lib/auth-storage';

const { Text, Title } = Typography;

export default function EvalRunsPage() {
  const { message } = App.useApp();
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState<EvalRunDetail | null>(null);
  // ⚠️ authStorage 读 localStorage，SSR 不可用 → 延迟到 mount 后再判定，避免 hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isAdmin = mounted && !!authStorage.getUser()?.isAdmin;

  const load = async () => {
    setLoading(true);
    try {
      setRuns(await evalService.list());
    } catch (err: any) {
      message.error(`加载失败：${err.response?.data?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  // 时序 chart：pass rate / tokens per accepted / retry rate 一起看
  // ⚠️ hooks 必须在 early return 之前，否则 mounted 状态切换会改变 hooks 顺序 → React 崩
  const trendOption = useMemo(() => {
    // 时序按 startedAt 升序展示（左老右新）
    const asc = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    const xs = asc.map((r) => new Date(r.startedAt).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['通过率(%)', 'Tokens/accepted', 'Retry率(%)'] },
      xAxis: { type: 'category', data: xs },
      yAxis: [
        { type: 'value', name: '%', position: 'left', max: 100 },
        { type: 'value', name: 'Tokens', position: 'right' },
      ],
      series: [
        {
          name: '通过率(%)',
          type: 'line',
          data: asc.map((r) => +(r.passRate * 100).toFixed(1)),
          smooth: true,
          itemStyle: { color: '#52c41a' },
        },
        {
          name: 'Tokens/accepted',
          type: 'line',
          yAxisIndex: 1,
          data: asc.map((r) => r.tokensPerAccepted),
          smooth: true,
          itemStyle: { color: '#1677ff' },
        },
        {
          name: 'Retry率(%)',
          type: 'line',
          data: asc.map((r) => +(r.retryRate * 100).toFixed(1)),
          smooth: true,
          itemStyle: { color: '#faad14' },
        },
      ],
      grid: { left: 60, right: 60, top: 40, bottom: 40 },
    };
  }, [runs]);

  const columns: ColumnsType<EvalRunSummary> = [
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      render: (t) => new Date(t).toLocaleString('zh-CN'),
      width: 200,
    },
    {
      title: 'Run ID',
      dataIndex: 'runId',
      width: 110,
      render: (id) => <code style={{ fontSize: 11 }}>{id}</code>,
    },
    {
      title: '通过',
      width: 110,
      render: (_, r) => (
        <Space>
          <Tag color={r.passRate >= 0.9 ? 'success' : r.passRate >= 0.7 ? 'processing' : 'warning'}>
            {(r.passRate * 100).toFixed(1)}%
          </Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {r.passed}/{r.totalTasks}
          </Text>
        </Space>
      ),
    },
    {
      title: '平均步数',
      dataIndex: 'avgSteps',
      width: 90,
      align: 'right',
      render: (v) => v.toFixed(1),
    },
    {
      title: '平均 Tokens',
      dataIndex: 'avgTokens',
      width: 110,
      align: 'right',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: (
        <Tooltip title='"cost per accepted change" — 每个通过任务平均花的 tokens'>
          Tokens/Accepted
        </Tooltip>
      ),
      dataIndex: 'tokensPerAccepted',
      width: 140,
      align: 'right',
      render: (v: number) => (
        <Text strong style={{ color: '#1677ff' }}>
          {v.toLocaleString()}
        </Text>
      ),
    },
    {
      title: 'Retry 率',
      dataIndex: 'retryRate',
      width: 100,
      align: 'right',
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: '耗时',
      dataIndex: 'totalDurationMs',
      width: 90,
      align: 'right',
      render: (v: number) => `${(v / 1000).toFixed(0)}s`,
    },
    {
      title: '',
      width: 80,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => void openDetail(r.runId)}>
          详情
        </Button>
      ),
    },
  ];

  const openDetail = async (runId: string) => {
    try {
      const d = await evalService.detail(runId);
      setDetailOpen(d);
    } catch (err: any) {
      message.error(`加载详情失败：${err.response?.data?.message || err.message}`);
    }
  };

  // 权限判定放在所有 hooks 之后，避免 hooks 顺序不一致
  if (!isAdmin) {
    return (
      <Layout.Content style={{ padding: 24 }}>
        <Alert type="warning" message="仅管理员可访问" showIcon />
      </Layout.Content>
    );
  }

  return (
    <Layout.Content style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Space
        style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}
        align="start"
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <DashboardOutlined /> Eval Runs History
          </Title>
          <Text type="secondary">
            每次改 prompt / 加工具后跑 <code>npm run eval</code> — 这里看趋势，评估驱动优化
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      </Space>

      {runs.length === 0 && !loading ? (
        <Empty description="还没有 eval run — 到 backend 目录跑 npm run eval" />
      ) : (
        <>
          <Card
            size="small"
            title={
              <Space>
                <LineChartOutlined /> 时序趋势（左新→右老 反过来看更直观：右侧是最近）
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <ReactECharts option={trendOption} style={{ height: 320 }} />
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <BarChartOutlined /> 全部 {runs.length} 次 Run
              </Space>
            }
          >
            <Table
              rowKey="runId"
              columns={columns}
              dataSource={runs}
              size="small"
              pagination={{ pageSize: 30, showSizeChanger: false }}
              loading={loading}
            />
          </Card>
        </>
      )}

      <Modal
        open={!!detailOpen}
        onCancel={() => setDetailOpen(null)}
        footer={null}
        width={1000}
        title={
          detailOpen ? (
            <Space>
              <Text strong>Run {detailOpen.runId}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(detailOpen.startedAt).toLocaleString('zh-CN')}
              </Text>
            </Space>
          ) : null
        }
      >
        {detailOpen && (
          <RunDetail detail={detailOpen} />
        )}
      </Modal>
    </Layout.Content>
  );
}

const RunDetail: React.FC<{ detail: EvalRunDetail }> = ({ detail }) => {
  return (
    <div style={{ maxHeight: 700, overflowY: 'auto' }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {detail.results.map((res) => (
          <Card
            key={res.taskId}
            size="small"
            style={{
              borderColor: res.passed ? '#b7eb8f' : '#ffa39e',
              background: res.passed ? '#f6ffed' : '#fff1f0',
            }}
            title={
              <Space>
                {res.passed ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )}
                <Text strong>{res.taskId}</Text>
                <Tag>{res.category}</Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  steps={res.metrics.steps} tokens={res.metrics.totalTokens.toLocaleString()}{' '}
                  retries={res.metrics.verifierRetries}
                </Text>
              </Space>
            }
          >
            {res.failureReasons.length > 0 && (
              <Alert
                type="error"
                message={res.failureReasons.join(' / ')}
                showIcon
                style={{ marginBottom: 8, padding: '4px 8px' }}
              />
            )}
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Tools: </Text>
              <Text style={{ fontSize: 12 }}>
                {res.trace.toolCalls.map((t) => t.toolName).join(' → ')}
              </Text>
            </div>
            {res.trace.narrative && (
              <div style={{ background: '#fafafa', padding: 8, borderRadius: 4, fontSize: 12 }}>
                {res.trace.narrative}
              </div>
            )}
            {res.trace.verifierReviews && res.trace.verifierReviews.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {res.trace.verifierReviews.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      marginTop: 4,
                      padding: 6,
                      background: v.shouldRetry ? '#fff7e6' : '#f0f5ff',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <Text strong>Verifier attempt {v.attempt}: </Text>
                    <Tag color={v.confidence >= 0.7 ? 'success' : 'warning'}>
                      conf {(v.confidence * 10).toFixed(1)}/10
                    </Tag>
                    {v.shouldRetry && <Tag color="orange">RETRY</Tag>}
                    {v.feedback && (
                      <div style={{ marginTop: 4, color: '#8c8c8c' }}>{v.feedback}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </Space>
    </div>
  );
};
