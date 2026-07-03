import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { widgetService, Widget, WidgetChartConfig, WidgetParam } from '@/services';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  widget: Widget;
  /** 保存 + refresh 完成后回传新 widget */
  onUpdated: (w: Widget) => void;
}

const CHART_OPTIONS = [
  { value: 'table', label: '📋 表格' },
  { value: 'bar', label: '📊 柱状' },
  { value: 'line', label: '📈 折线' },
  { value: 'pie', label: '🥧 饼图' },
  { value: 'kpi', label: '🔢 KPI' },
];

const TYPE_OPTIONS: { value: WidgetParam['type']; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'daterange', label: '日期范围' },
  { value: 'enum', label: '枚举' },
];

/**
 * Widget 设置 Modal — 单 widget 独立配置
 *
 * 支持编辑：
 *   - 展示：标题 / 描述 / 图表类型
 *   - 参数：每个参数的 default（改完保存 + 立即用新值 refresh 该 widget）
 *   - 参数：可增删 param、改类型、enum 时补 options
 *
 * 顶部全局 filter 面板仍是"临时联动全部"；这里改的 default 是该 widget 的"本图默认视角"
 */
export const WidgetSettingsModal: React.FC<Props> = ({ open, onClose, widget, onUpdated }) => {
  const { message } = App.useApp();
  const [title, setTitle] = useState(widget.title);
  const [description, setDescription] = useState(widget.description || '');
  const [chartType, setChartType] = useState<WidgetChartConfig['type']>(widget.chartConfig.type);
  const [sql, setSql] = useState(widget.sql);
  const [params, setParams] = useState<WidgetParam[]>(widget.params || []);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [lastChanges, setLastChanges] = useState<
    Array<{ from: string; toPlaceholder: string; reason: string }>
  >([]);

  // 每次打开重置为 widget 当前值
  useEffect(() => {
    if (!open) return;
    setTitle(widget.title);
    setDescription(widget.description || '');
    setChartType(widget.chartConfig.type);
    setSql(widget.sql);
    setParams(widget.params || []);
    setLastChanges([]);
  }, [open, widget]);

  const runSuggest = async () => {
    setSuggesting(true);
    try {
      const s = await widgetService.suggestParams(sql, params);
      if (s.suggestedParams.length === 0 && s.suggestedSql === sql) {
        message.info('AI 没找到明显的可调参数 — 可以手动编辑 SQL 加 {{占位符}}');
      } else {
        setSql(s.suggestedSql);
        setParams(s.suggestedParams);
        setLastChanges(s.changes);
        message.success(`识别出 ${s.suggestedParams.length} 个参数，请检查后保存`);
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      message.warning('标题不能为空');
      return;
    }
    setSaving(true);
    try {
      // 1) 保存变更
      const updated = await widgetService.update(widget.id, {
        title: title.trim(),
        description: description.trim() || '',
        chartConfig: { ...widget.chartConfig, type: chartType },
        sql,
        params: params.length > 0 ? params : null,
      });
      // 2) 用新 default 立刻刷一次 —— 让用户看到本次修改的效果
      try {
        const refreshed = await widgetService.refresh(widget.id, buildDefaultValues(params));
        onUpdated(refreshed);
        message.success('已保存并刷新');
      } catch (err: any) {
        // refresh 失败不阻塞保存
        onUpdated(updated);
        message.warning(`保存成功，但刷新失败：${err.response?.data?.message || err.message}`);
      }
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      okText="保存并刷新"
      width={720}
      title={
        <Space>
          <SettingOutlined />
          <Text strong>Widget 设置</Text>
          <Tag color="blue">{widget.title}</Tag>
        </Space>
      }
    >
      <Form layout="vertical">
        <Form.Item label="标题" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Form.Item>

        <Form.Item label="描述">
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={300}
          />
        </Form.Item>

        <Form.Item label="展示形式">
          <Segmented
            block
            value={chartType}
            onChange={(v) => setChartType(v as WidgetChartConfig['type'])}
            options={CHART_OPTIONS}
          />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            参数（查询范围与条件）
          </Text>
        </Divider>

        <div
          style={{
            marginBottom: 12,
            padding: 10,
            background: '#f0f5ff',
            borderRadius: 6,
            border: '1px dashed #91caff',
          }}
        >
          <Space size={8} align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Text style={{ fontSize: 12 }}>
                <ThunderboltOutlined style={{ color: '#faad14' }} /> 让 AI 识别 SQL 里"日期
                / 枚举 / 阈值"等硬编码值，一键改成可调参数
              </Text>
            </div>
            <Button
              type="primary"
              size="small"
              loading={suggesting}
              onClick={() => void runSuggest()}
              icon={<ThunderboltOutlined />}
            >
              🤖 智能识别
            </Button>
          </Space>
          {lastChanges.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                本次替换：
              </Text>
              {lastChanges.map((c, i) => (
                <Tooltip key={i} title={c.reason}>
                  <Tag color="blue" style={{ fontSize: 11, marginTop: 4 }}>
                    <code>{c.from}</code> → <code>{c.toPlaceholder}</code>
                  </Tag>
                </Tooltip>
              ))}
            </div>
          )}
        </div>

        <RollingTemplateBar params={params} onApply={setParams} />

        <ParamEditor sql={sql} params={params} onChange={setParams} />

        <Collapse
          size="small"
          ghost
          style={{ marginTop: 12 }}
          items={[
            {
              key: 'sql',
              label: (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  📝 SQL 源码（高级：可手动加 <code>{'{{占位符}}'}</code>）
                </Text>
              ),
              children: (
                <>
                  <Input.TextArea
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    autoSize={{ minRows: 4, maxRows: 12 }}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 6, padding: '4px 8px' }}
                    message={
                      <Text style={{ fontSize: 11 }}>
                        改错 SQL 会导致 widget 加载失败 —— 建议先在 chat 里验证
                      </Text>
                    }
                  />
                </>
              ),
            },
          ]}
        />

        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          说明：默认值 = 打开看板时该 widget 的初始视角。修改保存后会立即用新默认值刷新该
          widget。相对时间在每次刷新时按当天重算 —— 用它做"跟踪最近 N 天"这类持续场景。
        </Text>
      </Form>
    </Modal>
  );
};

/**
 * 滚动窗口模板 —— 检测到 startXxx + endXxx 双日期参数时展示 chip
 *
 * "跟踪最近 30 天" = startDate 设 @today-30d，endDate 设 @today
 * 一键设好，避免用户混淆"这两个到底该设成啥"
 */
const RollingTemplateBar: React.FC<{
  params: WidgetParam[];
  onApply: (next: WidgetParam[]) => void;
}> = ({ params, onApply }) => {
  // 查找 start/end 一对
  const pair = React.useMemo(() => {
    const dateParams = params.filter((p) => p.type === 'date');
    const startP = dateParams.find((p) => /^start/i.test(p.key));
    const endP = dateParams.find((p) => /^end/i.test(p.key));
    if (startP && endP) return { startP, endP };
    // 单个 date 参数（比如"某日订单"）也支持"今天"模板
    if (dateParams.length === 1) return { startP: dateParams[0], endP: undefined };
    return null;
  }, [params]);

  if (!pair) return null;

  const applyRolling = (startMacro: string, endMacro: string | undefined) => {
    onApply(
      params.map((p) => {
        if (p.key === pair.startP.key) return { ...p, default: startMacro };
        if (pair.endP && p.key === pair.endP.key) return { ...p, default: endMacro };
        return p;
      }),
    );
  };

  const templates = pair.endP
    ? [
        { label: '📅 最近 7 天', s: '@today-7d', e: '@today' },
        { label: '📅 最近 30 天', s: '@today-30d', e: '@today' },
        { label: '📅 最近 90 天', s: '@today-90d', e: '@today' },
        { label: '📆 本月至今', s: '@month_start', e: '@today' },
        { label: '📆 本季至今', s: '@quarter_start', e: '@today' },
        { label: '📆 本年至今', s: '@year_start', e: '@today' },
        { label: '⏮ 上月完整', s: '@last_month_start', e: '@last_month_end' },
      ]
    : [{ label: '📍 今天（每天前进）', s: '@today', e: undefined }];

  return (
    <div
      style={{
        padding: 10,
        marginBottom: 8,
        background: '#fffbe6',
        border: '1px dashed #ffe58f',
        borderRadius: 6,
      }}
    >
      <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        <ThunderboltOutlined style={{ color: '#faad14' }} /> 想让此 widget
        <Text strong>每次刷新都是"实时最新"</Text>？一键套用滚动窗口：
      </Text>
      <Space wrap size={4}>
        {templates.map((t) => (
          <Tag
            key={t.label}
            color="gold"
            style={{ cursor: 'pointer', padding: '2px 8px', fontSize: 12 }}
            onClick={() => applyRolling(t.s, t.e)}
          >
            {t.label}
          </Tag>
        ))}
      </Space>
      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 6 }}>
        点上面任一，会自动把 <code>{pair.startP.key}</code>
        {pair.endP && ` 和 <code>${pair.endP.key}</code>`} 设成对应相对时间
      </Text>
    </div>
  );
};

/** 把 params 数组的 default 值汇总成 refresh 用的 paramValues */
function buildDefaultValues(params: WidgetParam[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of params) {
    if (p.default !== undefined && p.default !== null && p.default !== '') {
      out[p.key] = p.default;
    }
  }
  return out;
}

interface ParamEditorProps {
  sql: string;
  params: WidgetParam[];
  onChange: (next: WidgetParam[]) => void;
}

const ParamEditor: React.FC<ParamEditorProps> = ({ sql, params, onChange }) => {
  // 从 SQL 抽还没定义的占位符 → 一键补齐
  const undefinedPlaceholders = React.useMemo(() => {
    const matches = sql.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) || [];
    const inSql = new Set(matches.map((m) => m.slice(2, -2)));
    for (const p of params) {
      inSql.delete(p.key);
      if (p.type === 'daterange') {
        const cap = p.key.charAt(0).toUpperCase() + p.key.slice(1);
        inSql.delete(`start${cap}`);
        inSql.delete(`end${cap}`);
      }
    }
    return Array.from(inSql);
  }, [sql, params]);

  const updateAt = (idx: number, patch: Partial<WidgetParam>) => {
    onChange(params.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const removeAt = (idx: number) => {
    onChange(params.filter((_, i) => i !== idx));
  };

  const addFromPlaceholder = (key: string) => {
    onChange([...params, { key, label: key, type: 'text', default: '' }]);
  };

  return (
    <>
      {undefinedPlaceholders.length > 0 && (
        <div style={{ marginBottom: 8, padding: 8, background: '#fff7e6', borderRadius: 4 }}>
          <Text style={{ fontSize: 12 }}>
            SQL 中有未定义的占位符：
            {undefinedPlaceholders.map((k) => (
              <Tag
                key={k}
                icon={<PlusOutlined />}
                color="orange"
                style={{ cursor: 'pointer', marginLeft: 4 }}
                onClick={() => addFromPlaceholder(k)}
              >{`{{${k}}}`}</Tag>
            ))}
          </Text>
        </div>
      )}

      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={params}
        locale={{ emptyText: 'SQL 里没检测到 {{占位符}}，无需参数' }}
        columns={[
          {
            title: '占位符',
            dataIndex: 'key',
            width: 130,
            render: (k) => <code style={{ fontSize: 11 }}>{`{{${k}}}`}</code>,
          },
          {
            title: '显示名',
            dataIndex: 'label',
            render: (v, _, i) => (
              <Input
                size="small"
                value={v}
                onChange={(e) => updateAt(i, { label: e.target.value })}
              />
            ),
          },
          {
            title: '类型',
            dataIndex: 'type',
            width: 110,
            render: (v, _, i) => (
              <Select
                size="small"
                value={v}
                style={{ width: '100%' }}
                onChange={(type: WidgetParam['type']) => updateAt(i, { type })}
                options={TYPE_OPTIONS}
              />
            ),
          },
          {
            title: '默认值',
            dataIndex: 'default',
            render: (_, row, i) => (
              <DefaultValueControl
                param={row}
                onChange={(dflt) => updateAt(i, { default: dflt })}
              />
            ),
          },
          {
            title: 'Options',
            width: 160,
            render: (_, row, i) =>
              row.type === 'enum' ? (
                <Select
                  size="small"
                  mode="tags"
                  value={row.options || []}
                  onChange={(options: string[]) => updateAt(i, { options })}
                  placeholder="回车分隔"
                  style={{ width: '100%' }}
                />
              ) : (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  —
                </Text>
              ),
          },
          {
            title: '',
            width: 32,
            render: (_, __, i) => (
              <Tooltip title="删除该参数">
                <Button
                  danger
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => removeAt(i)}
                />
              </Tooltip>
            ),
          },
        ]}
      />
    </>
  );
};

const RELATIVE_PRESETS = [
  { value: '@today', label: '今天（每天前进）' },
  { value: '@yesterday', label: '昨天' },
  { value: '@today-7d', label: '今天 - 7 天' },
  { value: '@today-30d', label: '今天 - 30 天' },
  { value: '@today-90d', label: '今天 - 90 天' },
  { value: '@today-1y', label: '今天 - 1 年' },
  { value: '@month_start', label: '本月初' },
  { value: '@month_end', label: '本月末' },
  { value: '@last_month_start', label: '上月初' },
  { value: '@last_month_end', label: '上月末' },
  { value: '@quarter_start', label: '本季初' },
  { value: '@year_start', label: '本年初' },
];

/** 简易客户端宏解析 — 展示"当前会解析成哪天"，跟后端算法一致 */
function resolveMacroClientSide(macro: string, now = new Date()): string | null {
  const s = macro.trim();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  if (s === '@today') return fmt(now);
  if (s === '@yesterday') return fmt(new Date(y, m, d - 1));
  if (s === '@tomorrow') return fmt(new Date(y, m, d + 1));
  if (s === '@month_start') return fmt(new Date(y, m, 1));
  if (s === '@month_end') return fmt(new Date(y, m + 1, 0));
  if (s === '@last_month_start') return fmt(new Date(y, m - 1, 1));
  if (s === '@last_month_end') return fmt(new Date(y, m, 0));
  if (s === '@year_start') return fmt(new Date(y, 0, 1));
  if (s === '@year_end') return fmt(new Date(y, 11, 31));
  if (s === '@quarter_start') return fmt(new Date(y, Math.floor(m / 3) * 3, 1));
  if (s === '@quarter_end') return fmt(new Date(y, Math.floor(m / 3) * 3 + 3, 0));
  const off = s.match(/^@today([+-])(\d+)([dwmy])$/);
  if (off) {
    const sign = off[1] === '+' ? 1 : -1;
    const n = parseInt(off[2], 10) * sign;
    const u = off[3];
    if (u === 'd') return fmt(new Date(y, m, d + n));
    if (u === 'w') return fmt(new Date(y, m, d + n * 7));
    if (u === 'm') return fmt(new Date(y, m + n, d));
    if (u === 'y') return fmt(new Date(y + n, m, d));
  }
  return null;
}

/** 一个日期输入：切换"固定 vs 相对宏"，相对宏预览解析结果 */
const DateInputWithMacro: React.FC<{ value?: any; onChange: (v: any) => void }> = ({
  value,
  onChange,
}) => {
  const isMacro = typeof value === 'string' && value.startsWith('@');
  const [mode, setMode] = useState<'fixed' | 'relative'>(isMacro ? 'relative' : 'fixed');
  React.useEffect(() => {
    // value 从外部换了（比如 AI 建议应用后），mode 跟着走
    setMode(isMacro ? 'relative' : 'fixed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const resolved = isMacro ? resolveMacroClientSide(value as string) : null;

  return (
    <div>
      <Segmented
        size="small"
        block
        value={mode}
        onChange={(v) => {
          const next = v as 'fixed' | 'relative';
          setMode(next);
          // 切换模式清值，让用户重选（避免"固定日期"塞进"相对宏"字段）
          if (next === 'fixed' && isMacro) onChange('');
          if (next === 'relative' && !isMacro) onChange('@today');
        }}
        options={[
          { value: 'fixed', label: '固定日期' },
          { value: 'relative', label: '相对时间' },
        ]}
        style={{ marginBottom: 4 }}
      />
      {mode === 'fixed' ? (
        <DatePicker
          size="small"
          value={value && !isMacro ? dayjs(value) : null}
          onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : '')}
          style={{ width: '100%' }}
        />
      ) : (
        <>
          <Select
            size="small"
            value={value}
            onChange={onChange}
            style={{ width: '100%' }}
            options={[
              ...RELATIVE_PRESETS,
              { value: '__custom__', label: '自定义宏…', disabled: true },
            ]}
            popupRender={(menu) => (
              <>
                {menu}
                <div style={{ padding: 4, borderTop: '1px solid #f0f0f0' }}>
                  <Input
                    size="small"
                    placeholder="@today-14d / @today+1m …"
                    onPressEnter={(e) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v) onChange(v);
                    }}
                  />
                </div>
              </>
            )}
          />
          {resolved && (
            <Text type="secondary" style={{ fontSize: 10, marginTop: 2, display: 'block' }}>
              → {resolved}（每次刷新按当天重算）
            </Text>
          )}
        </>
      )}
    </div>
  );
};

const DefaultValueControl: React.FC<{ param: WidgetParam; onChange: (v: any) => void }> = ({
  param,
  onChange,
}) => {
  switch (param.type) {
    case 'number':
      return (
        <InputNumber
          size="small"
          value={param.default}
          onChange={onChange}
          style={{ width: '100%' }}
        />
      );
    case 'date':
      return <DateInputWithMacro value={param.default} onChange={onChange} />;
    case 'daterange': {
      const arr = Array.isArray(param.default) ? param.default : ['', ''];
      return (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <DateInputWithMacro
            value={arr[0]}
            onChange={(v) => onChange([v, arr[1] || ''])}
          />
          <DateInputWithMacro
            value={arr[1]}
            onChange={(v) => onChange([arr[0] || '', v])}
          />
        </Space>
      );
    }
    case 'enum':
      return (
        <Select
          size="small"
          value={param.default}
          onChange={onChange}
          allowClear
          options={(param.options || []).map((o) => ({ value: o, label: o }))}
          style={{ width: '100%' }}
        />
      );
    case 'text':
    default:
      return (
        <Input
          size="small"
          value={param.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
};
