import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { DashboardLayoutItem, Widget } from '@/services';

const ResponsiveGridLayout = WidthProvider(Responsive);

const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const ROW_HEIGHT = 32;

interface Props {
  widgets: Widget[];
  layout: DashboardLayoutItem[] | null;
  onLayoutChange: (next: DashboardLayoutItem[]) => void;
  renderWidget: (w: Widget) => React.ReactNode;
}

/** 根据 widget.width/height 生成默认 layout（用户没设时的初始态）*/
function defaultLayout(widgets: Widget[]): DashboardLayoutItem[] {
  const items: DashboardLayoutItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const w of widgets) {
    const gridW = w.width === 'full' ? 12 : w.width === 'half' ? 6 : 4;
    const gridH = w.height === 'small' ? 6 : w.height === 'large' ? 14 : 10;
    // 换行
    if (x + gridW > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    items.push({ i: w.id, x, y, w: gridW, h: gridH });
    x += gridW;
    rowH = Math.max(rowH, gridH);
  }
  return items;
}

/**
 * WidgetGrid — react-grid-layout 包装
 *
 * - 首次渲染用 dashboard.layout（如果有）否则用 widget.width/height 生成默认
 * - 拖拽 / 缩放变化 → onLayoutChange（父组件 debounce 后 PATCH 后端）
 * - handle: Card 的 title 区（.rgl-drag-handle）；避免误触 body 里的按钮
 */
export const WidgetGrid: React.FC<Props> = ({ widgets, layout, onLayoutChange, renderWidget }) => {
  const effectiveLayout = useMemo<DashboardLayoutItem[]>(() => {
    if (!layout || layout.length === 0) return defaultLayout(widgets);
    // 保证每个 widget 都在 layout 里（后加的 widget 补默认位置）
    const known = new Set(layout.map((l) => l.i));
    const extras = widgets.filter((w) => !known.has(w.id));
    if (extras.length === 0) return layout.filter((l) => widgets.some((w) => w.id === l.i));
    const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const extraLayout = defaultLayout(extras).map((l) => ({ ...l, y: l.y + maxY }));
    return [...layout, ...extraLayout];
  }, [layout, widgets]);

  // RGL 内部 layouts prop 需要按 breakpoint 分。lg 用 effective，其余复用。
  const layouts = useMemo(() => ({ lg: effectiveLayout, md: effectiveLayout }), [effectiveLayout]);

  const handleChange = (next: Layout[]) => {
    const cleaned = next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));
    onLayoutChange(cleaned);
  };

  return (
    <ResponsiveGridLayout
      className="layout"
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      onLayoutChange={handleChange}
      draggableHandle=".rgl-drag-handle"
      margin={[12, 12]}
      containerPadding={[0, 0]}
    >
      {widgets.map((w) => (
        <div key={w.id}>{renderWidget(w)}</div>
      ))}
    </ResponsiveGridLayout>
  );
};

// 兼容：外部想直接引默认 layout 生成器
export { defaultLayout as computeDefaultLayout };
