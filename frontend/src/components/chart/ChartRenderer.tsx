import React from 'react';
import { Button, Empty, Space, Table, Tooltip } from 'antd';
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons';
import dynamic from 'next/dynamic';
import type { ChartConfig } from '@/types';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface ChartRendererProps {
  config?: ChartConfig;
  height?: number;
  /** 字段技术名 → 业务名映射；表头/图例优先用业务名 */
  columnDisplayMap?: Record<string, string>;
  /** 导出 CSV / Excel 时用的文件名前缀（如 "5月22日各站点单量"）*/
  exportFileName?: string;
}

export const ChartRenderer: React.FC<ChartRendererProps> = ({
  config,
  height = 360,
  columnDisplayMap = {},
  exportFileName,
}) => {
  if (!config) return <Empty description="无图表数据" />;

  // 业务名映射函数
  const labelOf = (raw: string): string => columnDisplayMap[raw] || raw;

  // ============ 表格 ============
  if (config.type === 'table') {
    const cols = config.table?.columns || [];
    const rows = config.table?.rows || [];
    if (!cols.length || !rows.length) {
      return <Empty description="查询无结果" />;
    }
    const dataSource = rows.map((row, idx) => ({ ...row, __rowKey: idx }));

    const filenameBase = exportFileName || `data-${dateStamp()}`;

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <Space size={4}>
            <Tooltip title="下载 CSV">
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => exportCsv(filenameBase, cols, rows, labelOf)}
              >
                CSV
              </Button>
            </Tooltip>
            <Tooltip title="下载 Excel (.xlsx)">
              <Button
                size="small"
                icon={<FileExcelOutlined />}
                onClick={() => exportExcel(filenameBase, cols, rows, labelOf)}
              >
                Excel
              </Button>
            </Tooltip>
          </Space>
        </div>
        <Table
          size="small"
          columns={cols.map((c) => ({
            title: labelOf(c.title),
            dataIndex: c.dataIndex,
            key: c.key,
            ellipsis: true,
            render: (v) => formatCell(v),
          }))}
          dataSource={dataSource}
          rowKey="__rowKey"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
        />
      </div>
    );
  }

  // ============ ECharts ============
  if (!config.option) return <Empty description="图表配置缺失" />;

  // 给 ECharts option 补充 toolbox (saveAsImage / dataView / dataZoom)
  // 同时用 columnDisplayMap 翻译 legend / series.name / yAxis name
  const enhanced = enhanceEchartsOption(config.option, labelOf, exportFileName);

  return (
    <ReactECharts
      option={enhanced}
      style={{ height, width: '100%' }}
      notMerge
      lazyUpdate
    />
  );
};

// =============== Helpers ===============

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportCsv(
  baseName: string,
  cols: { title: string; dataIndex: string }[],
  rows: Record<string, any>[],
  labelOf: (raw: string) => string,
) {
  const headers = cols.map((c) => escapeCsv(labelOf(c.title))).join(',');
  const body = rows
    .map((row) => cols.map((c) => escapeCsv(row[c.dataIndex])).join(','))
    .join('\n');
  // 加 BOM 让 Excel 打开 CSV 不乱码
  const csv = '﻿' + headers + '\n' + body;
  triggerDownload(`${baseName}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

async function exportExcel(
  baseName: string,
  cols: { title: string; dataIndex: string }[],
  rows: Record<string, any>[],
  labelOf: (raw: string) => string,
) {
  // 动态 import 避免 SSR 报错
  const XLSX = await import('xlsx');
  const headers = cols.map((c) => labelOf(c.title));
  const dataRows = rows.map((row) =>
    cols.map((c) => {
      const v = row[c.dataIndex];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    }),
  );
  const aoa = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    `${baseName}.xlsx`,
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 给 ECharts option 加 toolbox（PNG下载 / 数据视图 / 缩放）
 * 同时尝试翻译 legend / series.name
 */
function enhanceEchartsOption(
  option: Record<string, any>,
  labelOf: (raw: string) => string,
  exportFileName?: string,
): Record<string, any> {
  const out = { ...option };

  // 翻译 series.name
  if (Array.isArray(out.series)) {
    out.series = out.series.map((s: any) => ({
      ...s,
      name: s?.name ? labelOf(s.name) : s?.name,
    }));
  }
  // 翻译 legend.data
  if (out.legend?.data && Array.isArray(out.legend.data)) {
    out.legend = { ...out.legend, data: out.legend.data.map((n: string) => labelOf(n)) };
  }
  // 翻译 yAxis name
  if (out.yAxis?.name) {
    out.yAxis = { ...out.yAxis, name: labelOf(out.yAxis.name) };
  }
  // 翻译 xAxis name
  if (out.xAxis?.name) {
    out.xAxis = { ...out.xAxis, name: labelOf(out.xAxis.name) };
  }

  // 注入 toolbox
  out.toolbox = {
    show: true,
    right: 10,
    top: 0,
    feature: {
      saveAsImage: {
        type: 'png',
        title: '下载 PNG',
        name: exportFileName || `chart-${dateStamp()}`,
        pixelRatio: 2,
      },
      dataView: { show: true, title: '数据视图', readOnly: true, lang: ['数据', '关闭', '刷新'] },
      dataZoom: { show: true, title: { zoom: '缩放', back: '还原' } },
      restore: { show: true, title: '还原' },
    },
  };

  // 给 grid 留出 toolbox 空间
  if (out.grid) {
    out.grid = { ...out.grid, top: Math.max(out.grid.top || 20, 40) };
  } else {
    out.grid = { top: 40, left: 50, right: 30, bottom: 60 };
  }

  return out;
}
