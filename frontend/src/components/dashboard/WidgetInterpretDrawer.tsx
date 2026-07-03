import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Empty,
  List,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  AlertOutlined,
  BulbOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { widgetService, Widget, WidgetInterpretation } from '@/services';

const { Text, Title, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  widget: Widget | null;
}

/**
 * 单 widget 深度解读 Drawer
 *
 * 与整版解读（横向对比）不同：这里追求纵向深挖
 *   - 一句话结论 + 关键数字
 *   - 3-5 个细节发现
 *   - 异常对象
 *   - 推荐下钻问题（一键复制到 chat 追问）
 */
export const WidgetInterpretDrawer: React.FC<Props> = ({ open, onClose, widget }) => {
  const { message } = App.useApp();
  const [data, setData] = useState<WidgetInterpretation | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const run = async () => {
    if (!widget) return;
    setLoading(true);
    setErrMsg(null);
    try {
      const res = await widgetService.interpret(widget.id);
      setData(res);
    } catch (err: any) {
      setErrMsg(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  // 每次开一个新 widget 都重跑；关闭清空
  useEffect(() => {
    if (open && widget) {
      setData(null);
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, widget?.id]);

  const copyQuestion = (q: string) => {
    navigator.clipboard.writeText(q);
    message.success('问题已复制，粘贴到 chat 继续追问');
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          <Text strong>解读本图</Text>
          {widget && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              · {widget.title}
            </Text>
          )}
        </Space>
      }
      width={480}
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => void run()}
          loading={loading}
        >
          重跑
        </Button>
      }
    >
      {loading && !data ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 }}>
          <Spin size="large" />
          <Text type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            AI 正在读这张图的数据…
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
        <Empty description="点右上「重跑」开始" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 核心结论 */}
          <div>
            <Title level={5} style={{ marginBottom: 6 }}>
              <BulbOutlined style={{ color: '#1677ff' }} /> 核心结论
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
              {data.conclusion || '无结论'}
            </Paragraph>
          </div>

          {data.keyFindings.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 6 }}>
                📌 关键发现
              </Title>
              <List
                size="small"
                dataSource={data.keyFindings}
                renderItem={(f) => (
                  <List.Item style={{ padding: '6px 0' }}>
                    <Text style={{ fontSize: 13 }}>{f}</Text>
                  </List.Item>
                )}
              />
            </div>
          )}

          {data.anomalies.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 6 }}>
                <AlertOutlined style={{ color: '#ff4d4f' }} /> 异常点
              </Title>
              <List
                size="small"
                dataSource={data.anomalies}
                renderItem={(a) => (
                  <List.Item style={{ padding: '6px 0' }}>
                    <div style={{ width: '100%' }}>
                      <Tag color="red">{a.item}</Tag>
                      <Text style={{ fontSize: 13 }}>{a.description}</Text>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}

          {data.nextQuestions.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 6 }}>
                <QuestionCircleOutlined style={{ color: '#722ed1' }} /> 建议追问
              </Title>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {data.nextQuestions.map((q, i) => (
                  <Button
                    key={i}
                    block
                    style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: 8 }}
                    onClick={() => copyQuestion(q)}
                  >
                    <Text style={{ fontSize: 12 }}>{q}</Text>
                  </Button>
                ))}
              </Space>
              <Text type="secondary" style={{ fontSize: 10, marginTop: 4, display: 'block' }}>
                点击复制到剪贴板，粘贴到 chat 继续挖
              </Text>
            </div>
          )}

          <Text type="secondary" style={{ fontSize: 11 }}>
            基于 {data.meta.rowsScanned} 行数据 · 生成于{' '}
            {new Date(data.meta.generatedAt).toLocaleString('zh-CN')}
          </Text>
        </Space>
      )}
    </Drawer>
  );
};
