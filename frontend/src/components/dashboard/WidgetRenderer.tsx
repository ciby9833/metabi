/**
 * WidgetRenderer — 根据 widget.chartConfig.type 渲染
 *
 * 视觉设计原则：
 *   - KPI 卡片：大数字 + 图标 + 描述；副字段自动作为"对比值"计算环比
 *   - Table：数字列右对齐 + 千分位、表头加深、悬停高亮
 *   - Bar/Line：品牌蓝主色，浅 grid 线，Y 轴自动千分位
 *   - Pie：显示百分比 + 数值
 */
import React, { useMemo } from 'react';
import { Empty, Space, Table, Tag, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { Widget } from '@/services';

const { Text } = Typography;

interface Props {
  widget: Widget;
}

/** 千分位格式化 —— 保留原始精度，只加逗号 */
function fmtNumber(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // 大整数用千分位；小数保留原始有效位
  if (Number.isInteger(n)) return n.toLocaleString('zh-CN');
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** 判断列是否 numeric —— 用 pg 类型名 */
function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return /int|numeric|decimal|float|double|real|money/.test(t);
}

/** 缩写超大数字（K/M/B）—— 只在 KPI 大数字位使用 */
function fmtCompact(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return n.toLocaleString('zh-CN');
}

/** KPI 环比：主值/对比值 → 百分比 + 方向 */
function computeDelta(current: any, previous: any): { pct: number; direction: 'up' | 'down' } | null {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  const pct = ((c - p) / Math.abs(p)) * 100;
  return { pct, direction: pct >= 0 ? 'up' : 'down' };
}

export const WidgetRenderer: React.FC<Props> = ({ widget }) => {
  const data = widget.resultSnapshot;

  const echartsOption = useMemo(() => {
    if (!data || data.rows.length === 0) return null;
    const cols = data.columns.map((c) => c.name);
    if (cols.length < 2) return null;
    const dim = cols[0];
    const metrics = cols.slice(1);
    const categories = data.rows.map((r) => String(r[dim]));
    const series = metrics.map((m, i) => ({
      name: m,
      type: widget.chartConfig.type as 'bar' | 'line',
      data: data.rows.map((r) => {
        const n = Number(r[m]);
        return Number.isFinite(n) ? n : 0;
      }),
      smooth: widget.chartConfig.type === 'line',
      itemStyle: {
        color: ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#eb2f96'][i % 5],
      },
      lineStyle:
        widget.chartConfig.type === 'line'
          ? { width: 2, color: ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#eb2f96'][i % 5] }
          : undefined,
      areaStyle:
        widget.chartConfig.type === 'line'
          ? { opacity: 0.08 }
          : undefined,
      barMaxWidth: 36,
    }));
    return {
      tooltip: {
        trigger: 'axis' as const,
        valueFormatter: (v: any) => fmtNumber(v),
      },
      legend: {
        show: metrics.length > 1,
        top: 0,
        textStyle: { fontSize: 11, color: '#595959' },
      },
      grid: {
        left: 50,
        right: 20,
        top: metrics.length > 1 ? 30 : 15,
        bottom: 28,
        containLabel: true,
      },
      xAxis: {
        type: 'category' as const,
        data: categories,
        axisLine: { lineStyle: { color: '#d9d9d9' } },
        axisLabel: { fontSize: 10, color: '#8c8c8c' },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          fontSize: 10,
          color: '#8c8c8c',
          formatter: (v: number) => fmtCompact(v),
        },
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' as const } },
      },
      series,
    };
  }, [data, widget.chartConfig.type]);

  const pieOption = useMemo(() => {
    if (!data || data.rows.length === 0) return null;
    const cols = data.columns.map((c) => c.name);
    if (cols.length < 2) return null;
    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: (p: any) => `${p.name}: ${fmtNumber(p.value)} (${p.percent}%)`,
      },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      series: [
        {
          type: 'pie' as const,
          radius: ['40%', '68%'],
          avoidLabelOverlap: true,
          label: {
            fontSize: 11,
            formatter: '{b}: {d}%',
          },
          labelLine: { length: 6, length2: 6 },
          data: data.rows.map((r) => ({
            name: String(r[cols[0]]),
            value: Number(r[cols[1]]) || 0,
          })),
          itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        },
      ],
      color: ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#eb2f96', '#13c2c2', '#fa541c'],
    };
  }, [data]);

  // 所有分支的外层容器：flex 撑满父区域（grid item 可拖）
  const fillStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  };

  if (!data || data.rows.length === 0) {
    return (
      <div style={{ ...fillStyle, alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="暂无数据 — 点右上角刷新" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  switch (widget.chartConfig.type) {
    case 'kpi': {
      const cols = data.columns.map((c) => c.name);
      const row = data.rows[0] || {};
      const mainKey = cols[0];
      const mainVal = row[mainKey];
      const secondaryKey = cols[1];
      const secondaryVal = secondaryKey ? row[secondaryKey] : undefined;

      const isDeltaMode =
        cols.length === 2 &&
        isNumericType(data.columns[0].type) &&
        isNumericType(data.columns[1].type) &&
        /prev|last|前|上|去|last_/i.test(secondaryKey || '');
      const delta = isDeltaMode ? computeDelta(mainVal, secondaryVal) : null;

      return (
        <div
          style={{
            ...fillStyle,
            padding: '16px 12px',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #f0f5ff 0%, #ffffff 60%)',
            borderRadius: 6,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
            {mainKey}
          </Text>
          <div
            style={{
              fontSize: 'clamp(28px, 6vw, 56px)',
              fontWeight: 700,
              color: '#1677ff',
              lineHeight: 1.1,
              letterSpacing: '-0.5px',
            }}
          >
            {fmtNumber(mainVal)}
          </div>
          {delta && (
            <div style={{ marginTop: 8 }}>
              <Tag
                color={delta.direction === 'up' ? 'success' : 'error'}
                icon={delta.direction === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                style={{ fontSize: 11, borderRadius: 12, padding: '2px 8px' }}
              >
                {Math.abs(delta.pct).toFixed(1)}%
              </Tag>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                vs {secondaryKey} · {fmtNumber(secondaryVal)}
              </Text>
            </div>
          )}
          {!delta && cols.length > 1 && (
            <Space wrap size={12} style={{ marginTop: 8 }}>
              {cols.slice(1).map((c) => (
                <div key={c}>
                  <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                    {c}
                  </Text>
                  <Text strong style={{ fontSize: 13 }}>
                    {fmtNumber(row[c])}
                  </Text>
                </div>
              ))}
            </Space>
          )}
        </div>
      );
    }
    case 'bar':
    case 'line':
      return echartsOption ? (
        <div style={fillStyle}>
          <ReactECharts
            option={echartsOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
          />
        </div>
      ) : (
        <Text type="secondary">数据结构不支持此图表类型</Text>
      );
    case 'pie':
      return pieOption ? (
        <div style={fillStyle}>
          <ReactECharts
            option={pieOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
          />
        </div>
      ) : (
        <Text type="secondary">饼图需 2 列（维度 + 数值）</Text>
      );
    case 'table':
    default:
      return (
        <div style={{ ...fillStyle, overflow: 'auto' }}>
          <Table
            size="small"
            rowKey={(_r, i) => String(i)}
            dataSource={data.rows}
            columns={data.columns.map((c) => {
              const numeric = isNumericType(c.type);
              return {
                title: c.name,
                dataIndex: c.name,
                ellipsis: true,
                align: (numeric ? 'right' : 'left') as 'right' | 'left',
                render: numeric ? (v: any) => <Text>{fmtNumber(v)}</Text> : undefined,
              };
            })}
            pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true }}
          />
        </div>
      );
  }
};
