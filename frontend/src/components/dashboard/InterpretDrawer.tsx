import React, { useState } from 'react';
import { App, Button, Divider, Drawer, Empty, List, Result, Space, Spin, Tag, Typography } from 'antd';
import {
  AlertOutlined,
  BulbOutlined,
  CopyOutlined,
  LinkOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { dashboardService, DashboardInterpretation } from '@/services';

const { Text, Title, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  dashboardId: string;
  dashboardName: string;
  paramValues: Record<string, any>;
}

/**
 * AI 解读 Drawer — 综合概述 + 异常 + 关联 + 建议
 *
 * 首次打开自动调用一次；重新解读按钮可再次触发
 * 生成的内容不持久化（每次都是实时算），避免过期洞见误导
 */
export const InterpretDrawer: React.FC<Props> = ({
  open,
  onClose,
  dashboardId,
  dashboardName,
  paramValues,
}) => {
  const { message } = App.useApp();
  const [data, setData] = useState<DashboardInterpretation | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const res = await dashboardService.interpret(dashboardId, paramValues);
      setData(res);
    } catch (err: any) {
      setErrMsg(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  // 首次打开自动跑；关闭再打开保留上次结果
  React.useEffect(() => {
    if (open && !data && !loading) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copyAll = () => {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`# ${dashboardName} · AI 综合解读`);
    lines.push('');
    lines.push(`## 概述`);
    lines.push(data.summary);
    if (data.anomalies.length > 0) {
      lines.push('');
      lines.push(`## 异常`);
      data.anomalies.forEach((a) => lines.push(`- 【${a.widget}】${a.description}`));
    }
    if (data.correlations.length > 0) {
      lines.push('');
      lines.push(`## 跨图关联`);
      data.correlations.forEach((c) =>
        lines.push(`- 【${c.widgets.join(' × ')}】${c.description}`),
      );
    }
    if (data.recommendations.length > 0) {
      lines.push('');
      lines.push(`## 下一步建议`);
      data.recommendations.forEach((r) => lines.push(`- **${r.action}** — ${r.description}`));
    }
    navigator.clipboard.writeText(lines.join('\n'));
    message.success('已复制到剪贴板');
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          <Text strong>AI 综合解读</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · {dashboardName}
          </Text>
        </Space>
      }
      width={520}
      extra={
        <Space>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void run()}
            loading={loading}
          >
            重新解读
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={copyAll} disabled={!data}>
            复制
          </Button>
        </Space>
      }
    >
      {loading && !data ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 }}>
          <Spin size="large" />
          <Text type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            AI 正在读所有 widget 的数据 · 跨图找关联…
          </Text>
        </div>
      ) : errMsg ? (
        <Result
          status="warning"
          title="解读失败"
          subTitle={errMsg}
          extra={<Button onClick={() => void run()}>重试</Button>}
        />
      ) : !data ? (
        <Empty description="点右上方「重新解读」开始" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 概述 */}
          <div>
            <Title level={5} style={{ marginBottom: 6 }}>
              <BulbOutlined style={{ color: '#1677ff' }} /> 综合概述
            </Title>
            <Paragraph
              style={{
                background: '#f0f5ff',
                padding: 12,
                borderRadius: 6,
                margin: 0,
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {data.summary || '无概述'}
            </Paragraph>
          </div>

          {/* 异常 */}
          {data.anomalies.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 6 }}>
                <AlertOutlined style={{ color: '#ff4d4f' }} /> 异常发现
              </Title>
              <List
                size="small"
                dataSource={data.anomalies}
                renderItem={(a) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <div style={{ width: '100%' }}>
                      <Tag color="red">{a.widget}</Tag>
                      <Text style={{ fontSize: 13 }}>{a.description}</Text>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}

          {/* 关联 */}
          {data.correlations.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 6 }}>
                <LinkOutlined style={{ color: '#722ed1' }} /> 跨图关联
              </Title>
              <List
                size="small"
                dataSource={data.correlations}
                renderItem={(c) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <div style={{ width: '100%' }}>
                      <Space size={2} wrap style={{ marginBottom: 4 }}>
                        {c.widgets.map((w, i) => (
                          <Tag key={i} color="purple">
                            {w}
                          </Tag>
                        ))}
                      </Space>
                      <Text style={{ fontSize: 13, display: 'block' }}>{c.description}</Text>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}

          {/* 建议 */}
          {data.recommendations.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 6 }}>
                🎯 下一步建议
              </Title>
              <List
                size="small"
                dataSource={data.recommendations}
                renderItem={(r) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <div style={{ width: '100%' }}>
                      <Text strong style={{ fontSize: 13, display: 'block' }}>
                        {r.action}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.description}
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}

          {data.anomalies.length === 0 &&
            data.correlations.length === 0 &&
            data.recommendations.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                — AI 只给出概述，未发现明显异常/关联/建议 —
              </Text>
            )}

          <Divider style={{ margin: '8px 0' }} />
          <Text type="secondary" style={{ fontSize: 11 }}>
            扫描 {data.meta.widgetCount} 个 widget · {data.meta.dataRowsScanned} 行数据 · 生成于{' '}
            {new Date(data.meta.generatedAt).toLocaleString('zh-CN')}
          </Text>
        </Space>
      )}
    </Drawer>
  );
};
