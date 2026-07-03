/**
 * SaveToDashboardButton — Chat 消息底部「💾 存到看板」按钮 + Modal
 *
 * 只在 message 有 sqlText 时显示（refused 消息不显示）
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import {
  DashboardOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import {
  dashboardService,
  projectService,
  widgetService,
  Dashboard,
  Project,
  WidgetChartConfig,
  WidgetParam,
} from '@/services';

const { Text } = Typography;

interface Props {
  messageId: string;
  /** 建议的 widget 标题（用问题的前若干字符）*/
  suggestedTitle?: string;
  /** 建议的图表类型（如果 backend/前端已推断）*/
  suggestedChartType?: WidgetChartConfig['type'];
  /** message.sqlText —— 用来识别 {{占位符}} 提示定义参数 */
  sql?: string;
}

/** 扫 SQL 提取 {{key}}，去重保序 */
function extractPlaceholders(sql: string | undefined): string[] {
  if (!sql) return [];
  const matches = sql.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const key = m.slice(2, -2);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export const SaveToDashboardButton: React.FC<Props> = ({
  messageId,
  suggestedTitle,
  suggestedChartType,
  sql,
}) => {
  const { message } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // 识别 SQL 中的占位符 —— 用户在存看板时定义参数（key/label/type/default）
  const placeholders = useMemo(() => extractPlaceholders(sql), [sql]);
  const [params, setParams] = useState<WidgetParam[]>([]);

  // 每次打开时用识别到的 placeholders 初始化 params（保留用户已改的）
  useEffect(() => {
    if (!open) return;
    setParams((prev) => {
      const prevMap = new Map(prev.map((p) => [p.key, p]));
      return placeholders.map(
        (k) => prevMap.get(k) || { key: k, label: k, type: 'text', default: '' },
      );
    });
  }, [open, placeholders]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([dashboardService.list(), projectService.list()])
      .then(([ds, ps]) => {
        setDashboards(ds);
        setProjects(ps);
        setMode(ds.length > 0 ? 'existing' : 'new');
        form.setFieldsValue({
          widgetTitle: suggestedTitle?.substring(0, 60) || '',
          chartType: suggestedChartType || 'table',
          dashboardId: ds[0]?.id,
        });
      })
      .catch(() => undefined);
  }, [open, form, suggestedTitle, suggestedChartType]);

  const handleSave = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const v = form.getFieldsValue();
    setSaving(true);
    try {
      const res = await widgetService.saveFromTurn({
        messageId,
        dashboardId: mode === 'existing' ? v.dashboardId : undefined,
        newDashboardName: mode === 'new' ? v.newDashboardName?.trim() : undefined,
        newDashboardProjectId: mode === 'new' ? v.newDashboardProjectId : undefined,
        widgetTitle: v.widgetTitle.trim(),
        widgetDescription: v.widgetDescription?.trim() || undefined,
        chartType: v.chartType,
        params: params.length > 0 ? params : null,
      });
      message.success('已固化到看板');
      setOpen(false);
      // 直接跳看板
      router.push(`/dashboards/${res.dashboard.id}`);
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Tooltip title="固化这次分析到看板 — 下次一键重看">
        <Button
          type="text"
          size="small"
          icon={<SaveOutlined />}
          onClick={() => setOpen(true)}
        >
          存到看板
        </Button>
      </Tooltip>

      <Modal
        open={open}
        title={
          <Space>
            <DashboardOutlined />
            固化到看板
          </Space>
        }
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="widgetTitle"
            label="Widget 标题"
            rules={[{ required: true, message: '给这块起个名字' }]}
          >
            <Input placeholder="如：5月大区订单量" maxLength={120} />
          </Form.Item>

          <Form.Item name="widgetDescription" label="描述（可选）">
            <Input.TextArea rows={2} placeholder="给团队看的说明" maxLength={300} />
          </Form.Item>

          <Form.Item name="chartType" label="展示形式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'table', label: '📋 表格' },
                { value: 'bar', label: '📊 柱状图' },
                { value: 'line', label: '📈 折线图' },
                { value: 'pie', label: '🥧 饼图' },
                { value: 'kpi', label: '🔢 KPI 数字' },
              ]}
            />
          </Form.Item>

          {placeholders.length > 0 && (
            <div
              style={{
                padding: 12,
                background: '#fff7e6',
                borderRadius: 6,
                marginBottom: 16,
                border: '1px solid #ffd591',
              }}
            >
              <Alert
                type="info"
                showIcon
                icon={<ThunderboltOutlined />}
                message={
                  <Text style={{ fontSize: 12 }}>
                    识别到 <Text strong>{placeholders.length}</Text> 个占位符 —— 定义为参数后，
                    看板顶部可改这些值联动重算
                  </Text>
                }
                style={{ marginBottom: 8, padding: '4px 12px' }}
              />
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={params}
                columns={[
                  {
                    title: '占位符',
                    dataIndex: 'key',
                    width: 120,
                    render: (k) => <code style={{ fontSize: 11 }}>{`{{${k}}}`}</code>,
                  },
                  {
                    title: '显示名',
                    dataIndex: 'label',
                    render: (v, r) => (
                      <Input
                        size="small"
                        value={v}
                        onChange={(e) => {
                          const label = e.target.value;
                          setParams((prev) =>
                            prev.map((p) => (p.key === r.key ? { ...p, label } : p)),
                          );
                        }}
                      />
                    ),
                  },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 110,
                    render: (v, r) => (
                      <Select
                        size="small"
                        value={v}
                        style={{ width: '100%' }}
                        onChange={(type) =>
                          setParams((prev) =>
                            prev.map((p) => (p.key === r.key ? { ...p, type } : p)),
                          )
                        }
                        options={[
                          { value: 'text', label: '文本' },
                          { value: 'number', label: '数字' },
                          { value: 'date', label: '日期' },
                          { value: 'enum', label: '枚举' },
                        ]}
                      />
                    ),
                  },
                  {
                    title: '默认值',
                    dataIndex: 'default',
                    render: (v, r) => (
                      <Input
                        size="small"
                        placeholder={r.type === 'date' ? 'YYYY-MM-DD' : ''}
                        value={v ?? ''}
                        onChange={(e) => {
                          const dflt = e.target.value;
                          setParams((prev) =>
                            prev.map((p) => (p.key === r.key ? { ...p, default: dflt } : p)),
                          );
                        }}
                      />
                    ),
                  },
                ]}
              />
              <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
                提示：type=enum 时需在存后进入 widget 编辑补 options；daterange 请把 SQL 改为
                <code>{`{{startXxx}}`}</code> / <code>{`{{endXxx}}`}</code> 两个占位符
              </Text>
            </div>
          )}

          <div style={{ padding: 12, background: '#fafafa', borderRadius: 6 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              目标看板
            </Text>
            <Radio.Group
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Radio value="existing" disabled={dashboards.length === 0}>
                  加到已有看板 {dashboards.length === 0 && '（还没有）'}
                </Radio>
                {mode === 'existing' && (
                  <Form.Item
                    name="dashboardId"
                    style={{ marginBottom: 8, marginLeft: 24 }}
                    rules={mode === 'existing' ? [{ required: true, message: '选一个看板' }] : []}
                  >
                    <Select
                      placeholder="选择看板"
                      options={dashboards.map((d) => ({
                        value: d.id,
                        label: `${d.icon || '📊'} ${d.name}${
                          d.projectId ? ' (项目共享)' : ' (个人)'
                        }`,
                      }))}
                    />
                  </Form.Item>
                )}
                <Radio value="new">
                  <PlusOutlined /> 新建看板
                </Radio>
                {mode === 'new' && (
                  <div style={{ marginLeft: 24 }}>
                    <Form.Item
                      name="newDashboardName"
                      style={{ marginBottom: 8 }}
                      rules={mode === 'new' ? [{ required: true, message: '看板名必填' }] : []}
                    >
                      <Input placeholder="看板名，如：日运单复盘" maxLength={100} />
                    </Form.Item>
                    <Form.Item name="newDashboardProjectId" style={{ marginBottom: 0 }}>
                      <Select
                        placeholder="归属（不选 = 个人看板）"
                        allowClear
                        options={projects.map((p) => ({
                          value: p.id,
                          label: `${p.name} (${p.memberCount || 1} 人)`,
                        }))}
                      />
                    </Form.Item>
                  </div>
                )}
              </Space>
            </Radio.Group>
          </div>
        </Form>
      </Modal>
    </>
  );
};
