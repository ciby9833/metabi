import React, { useMemo } from 'react';
import { Button, DatePicker, Form, InputNumber, Select, Space, Tooltip, Typography } from 'antd';
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Widget, WidgetParam } from '@/services';
import dayjs, { Dayjs } from 'dayjs';

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface Props {
  widgets: Widget[];
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
  onApply: () => void;
  loading?: boolean;
}

/**
 * 聚合所有 widget 的 params → 顶部统一 filter 面板
 *
 * 去重原则：同 key + 同 type 视为一致（用第一个 widget 的 label/options/default 作展示）
 * 冲突时（同 key 不同 type）跳过第二个，避免控件混乱
 */
export const DashboardFilterBar: React.FC<Props> = ({
  widgets,
  values,
  onChange,
  onApply,
  loading,
}) => {
  const mergedParams = useMemo<WidgetParam[]>(() => {
    const seen = new Map<string, WidgetParam>();
    for (const w of widgets) {
      if (!w.params) continue;
      for (const p of w.params) {
        if (!seen.has(p.key)) {
          seen.set(p.key, p);
        } else {
          const existing = seen.get(p.key)!;
          if (existing.type === p.type && p.type === 'enum') {
            // enum 合并 options
            const merged = Array.from(
              new Set([...(existing.options || []), ...(p.options || [])]),
            );
            seen.set(p.key, { ...existing, options: merged });
          }
          // 其他类型冲突：忽略，用第一个
        }
      }
    }
    return Array.from(seen.values());
  }, [widgets]);

  if (mergedParams.length === 0) return null;

  const setValue = (key: string, val: any) => {
    onChange({ ...values, [key]: val });
  };

  const resetToDefaults = () => {
    const next: Record<string, any> = {};
    for (const p of mergedParams) {
      if (p.default !== undefined) next[p.key] = p.default;
    }
    onChange(next);
  };

  return (
    <div
      style={{
        background: '#fff',
        padding: '12px 16px',
        borderRadius: 8,
        marginBottom: 12,
        border: '1px solid #e6f4ff',
      }}
    >
      <Space size={4} style={{ marginBottom: 8 }}>
        <FilterOutlined style={{ color: '#1677ff' }} />
        <Text strong style={{ fontSize: 13 }}>看板筛选</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          （改动后点「应用」全 widget 联动重算）
        </Text>
      </Space>
      <Form layout="inline" size="small" style={{ rowGap: 8 }}>
        {mergedParams.map((p) => (
          <Form.Item
            key={p.key}
            label={<Text style={{ fontSize: 12 }}>{p.label}</Text>}
            style={{ marginBottom: 0 }}
          >
            {renderControl(p, values[p.key], (v) => setValue(p.key, v))}
          </Form.Item>
        ))}
        <Form.Item style={{ marginBottom: 0 }}>
          <Space size={4}>
            <Tooltip title="用参数默认值">
              <Button size="small" onClick={resetToDefaults}>
                重置
              </Button>
            </Tooltip>
            <Button
              size="small"
              type="primary"
              icon={<ReloadOutlined />}
              onClick={onApply}
              loading={loading}
            >
              应用
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
};

function renderControl(p: WidgetParam, value: any, onChange: (v: any) => void) {
  switch (p.type) {
    case 'date':
      return (
        <DatePicker
          value={value ? dayjs(value) : null}
          onChange={(d: Dayjs | null) => onChange(d ? d.format('YYYY-MM-DD') : null)}
          size="small"
          style={{ width: 140 }}
        />
      );
    case 'daterange': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <RangePicker
          value={
            arr[0] && arr[1] ? [dayjs(arr[0]), dayjs(arr[1])] : null
          }
          onChange={(dates) =>
            onChange(
              dates && dates[0] && dates[1]
                ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]
                : null,
            )
          }
          size="small"
        />
      );
    }
    case 'enum':
      return (
        <Select
          value={value}
          onChange={onChange}
          size="small"
          style={{ minWidth: 140 }}
          allowClear
          options={(p.options || []).map((o: string) => ({ value: o, label: o }))}
        />
      );
    case 'number':
      return (
        <InputNumber
          value={value}
          onChange={(v) => onChange(v)}
          size="small"
          style={{ width: 100 }}
        />
      );
    case 'text':
    default:
      return (
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="ant-input ant-input-sm"
          style={{ width: 160, padding: '2px 8px' }}
        />
      );
  }
}
