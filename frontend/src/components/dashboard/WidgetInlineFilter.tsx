import React from 'react';
import { DatePicker, InputNumber, Select, Space, Tooltip, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { WidgetParam } from '@/services';

const { Text } = Typography;

interface Props {
  params: WidgetParam[];
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}

/**
 * 卡片内嵌 filter row —— 紧凑版
 *
 * 展示 widget 自己的 params 控件；改动 debounce 500ms 后触发本 widget refresh
 * 与顶部全局 filter 面板互斥：此组件出现，则不需要全局面板
 *
 * 相对宏（@today-30d 之类）在 filter 里降级为固定日期展示：
 *   filter 是"当前视角调整"，宏语义是"每次刷新时算"，混着会迷惑用户
 *   所以本组件里日期都以固定日期呈现（把宏预解析）
 */
export const WidgetInlineFilter: React.FC<Props> = ({ params, values, onChange }) => {
  if (!params || params.length === 0) return null;

  const setValue = (key: string, v: any) => {
    onChange({ ...values, [key]: v });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '6px 8px',
        background: '#fafafa',
        borderRadius: 4,
        marginBottom: 8,
        border: '1px solid #f0f0f0',
      }}
    >
      {params.map((p) => (
        <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{p.label}：</Text>
          {renderControl(p, values[p.key] ?? resolveDefault(p), (v) => setValue(p.key, v))}
        </div>
      ))}
      <Tooltip title="改动 0.5 秒后自动重跑此 widget，其他 widget 不受影响">
        <InfoCircleOutlined style={{ fontSize: 11, color: '#bfbfbf', marginLeft: 'auto' }} />
      </Tooltip>
    </div>
  );
};

function renderControl(p: WidgetParam, value: any, onChange: (v: any) => void) {
  switch (p.type) {
    case 'date': {
      const resolved = typeof value === 'string' && value.startsWith('@')
        ? resolveMacroClientSide(value)
        : value;
      return (
        <DatePicker
          size="small"
          value={resolved ? dayjs(resolved) : null}
          onChange={(d: Dayjs | null) => onChange(d ? d.format('YYYY-MM-DD') : '')}
          style={{ width: 130 }}
          allowClear={false}
        />
      );
    }
    case 'daterange': {
      const arr = Array.isArray(value) ? value : [];
      const a = arr[0] && String(arr[0]).startsWith('@') ? resolveMacroClientSide(arr[0]) : arr[0];
      const b = arr[1] && String(arr[1]).startsWith('@') ? resolveMacroClientSide(arr[1]) : arr[1];
      return (
        <DatePicker.RangePicker
          size="small"
          value={a && b ? [dayjs(a), dayjs(b)] : null}
          onChange={(dates) =>
            onChange(
              dates && dates[0] && dates[1]
                ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]
                : ['', ''],
            )
          }
        />
      );
    }
    case 'enum':
      return (
        <Select
          size="small"
          value={value}
          onChange={onChange}
          style={{ minWidth: 110 }}
          allowClear
          options={(p.options || []).map((o) => ({ value: o, label: o }))}
        />
      );
    case 'number':
      return (
        <InputNumber size="small" value={value} onChange={onChange} style={{ width: 90 }} />
      );
    case 'text':
    default:
      return (
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="ant-input ant-input-sm"
          style={{ width: 130, padding: '2px 6px' }}
        />
      );
  }
}

function resolveDefault(p: WidgetParam): any {
  if (p.default === undefined) return undefined;
  if (typeof p.default === 'string' && p.default.startsWith('@')) {
    return resolveMacroClientSide(p.default);
  }
  return p.default;
}

/** 与 WidgetSettingsModal 里的逻辑一致 */
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
