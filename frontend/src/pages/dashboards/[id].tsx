/**
 * /dashboards/[id] — 看板详情页
 *
 * Widget 网格布局（简单 flexbox；L3 引入 react-grid-layout 时再升级）
 * 每个 widget：标题 / 描述 / 图表 / 刷新 / 删除
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  App,
  Button,
  Card,
  Dropdown,
  Empty,
  Layout,
  Result,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { DashboardLayoutItem } from '@/services';
import {
  ArrowLeftOutlined,
  BulbOutlined,
  DeleteOutlined,
  DownloadOutlined,
  MessageOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import { dashboardService, widgetService, Dashboard, Widget } from '@/services';
import { WidgetRenderer } from '@/components/dashboard/WidgetRenderer';
import { InterpretDrawer } from '@/components/dashboard/InterpretDrawer';
import { WidgetSettingsModal } from '@/components/dashboard/WidgetSettingsModal';
import { WidgetInterpretDrawer } from '@/components/dashboard/WidgetInterpretDrawer';
import { WidgetInlineFilter } from '@/components/dashboard/WidgetInlineFilter';

// react-grid-layout 依赖 window / getBoundingClientRect —— 关闭 SSR 避免水合错乱
const WidgetGrid = dynamic(
  () => import('@/components/dashboard/WidgetGrid').then((m) => m.WidgetGrid),
  { ssr: false },
);

const { Text, Title, Paragraph } = Typography;

export default function DashboardDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { message, modal } = App.useApp();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  // 每 widget 独立的 filter values（key = widget.id）—— 改动后 debounce 重跑该 widget
  const [widgetFilters, setWidgetFilters] = useState<Record<string, Record<string, any>>>({});
  const filterRefreshTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [interpretOpen, setInterpretOpen] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutItem[] | null>(null);
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settingsWidget, setSettingsWidget] = useState<Widget | null>(null);
  const [interpretingWidget, setInterpretingWidget] = useState<Widget | null>(null);

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const [d, ws] = await Promise.all([
        dashboardService.get(id),
        dashboardService.listWidgets(id),
      ]);
      setDashboard(d);
      setWidgets(ws);
      setLayout(d.layout ?? null);
    } catch (err: any) {
      message.error(`加载失败：${err.response?.data?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 用 widget 自身的 inline filter values 刷新（fallback: 每 param 的 default）*/
  const refreshWidget = async (w: Widget, values?: Record<string, any>) => {
    setRefreshingIds((s) => new Set(s).add(w.id));
    try {
      const use = values ?? widgetFilters[w.id];
      const refreshed = await widgetService.refresh(w.id, use);
      setWidgets((prev) => prev.map((x) => (x.id === w.id ? refreshed : x)));
      if (!values) message.success(`「${w.title}」已刷新`);
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message);
    } finally {
      setRefreshingIds((s) => {
        const next = new Set(s);
        next.delete(w.id);
        return next;
      });
    }
  };

  const refreshAll = async () => {
    for (const w of widgets) {
      // eslint-disable-next-line no-await-in-loop
      await refreshWidget(w);
    }
  };

  /**
   * 卡片内嵌 filter 变化 —— debounce 500ms 后刷新该 widget
   * 避免用户拖动 datepicker / 输入时打爆后端
   */
  const handleInlineFilterChange = (w: Widget, next: Record<string, any>) => {
    setWidgetFilters((prev) => ({ ...prev, [w.id]: next }));
    const existing = filterRefreshTimers.current[w.id];
    if (existing) clearTimeout(existing);
    filterRefreshTimers.current[w.id] = setTimeout(() => {
      void refreshWidget(w, next);
    }, 500);
  };

  /**
   * 拖拽/缩放变化 → 保存 layout
   * debounce 800ms 避免连续拖拽期间打爆后端
   */
  const handleLayoutChange = (next: DashboardLayoutItem[]) => {
    setLayout(next);
    if (!dashboard) return;
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      dashboardService.update(dashboard.id, { layout: next }).catch((err) => {
        // 静默失败：布局保存不是关键路径；给个 warning 提示
        // eslint-disable-next-line no-console
        console.warn('layout save failed', err);
      });
    }, 800);
  };

  /**
   * 下载 widget 数据
   * mode='display' —— 跑 widget SQL（跟图表一致的聚合 top N）
   * mode='detail'  —— 走后端 AI 脱聚合 → 底表明细
   */
  const downloadWidget = async (
    w: Widget,
    format: 'xlsx' | 'csv',
    mode: 'display' | 'detail' = 'display',
  ) => {
    const hint = mode === 'detail' ? 'AI 正在生成明细查询…' : '下载中…';
    const key = `dl-${w.id}-${mode}`;
    message.loading({ content: hint, key, duration: 0 });
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get(
        `/v1/widgets/${w.id}/export?format=${format}&mode=${mode}`,
        { responseType: 'blob', timeout: 120000 },
      );
      const blob = new Blob([res.data], {
        type:
          format === 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const base = w.title.replace(/[\\/:*?"<>|\r\n]/g, '_').substring(0, 100) || 'widget';
      const suffix = mode === 'detail' ? '-明细' : '';
      a.download = `${base}${suffix}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success({ content: '已下载', key });
    } catch (err: any) {
      // blob 请求失败时 error data 是 blob，得转成文本
      let msg = err.response?.data?.message || err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          msg = parsed.message || text;
        } catch {
          // ignore
        }
      }
      message.error({ content: `下载失败：${msg}`, key });
    }
  };


  const removeWidget = (w: Widget) => {
    modal.confirm({
      title: `删除「${w.title}」？`,
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await widgetService.remove(w.id);
          setWidgets((prev) => prev.filter((x) => x.id !== w.id));
          message.success('已删除');
        } catch (err: any) {
          message.error(err.response?.data?.message || err.message);
        }
      },
    });
  };

  if (loading && !dashboard) {
    return (
      <Layout.Content style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <Spin />
      </Layout.Content>
    );
  }
  if (!dashboard) {
    return (
      <Layout.Content style={{ padding: 24 }}>
        <Result status="404" title="看板不存在" />
      </Layout.Content>
    );
  }

  return (
    <Layout.Content style={{ padding: '20px 24px', background: '#f5f5f5', minHeight: '100vh' }}>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/dashboards')}
        >
          返回
        </Button>
      </Space>

      <div
        style={{
          background: '#fff',
          padding: '16px 20px',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {dashboard.icon} {dashboard.name}
          </Title>
          {dashboard.description && (
            <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
              {dashboard.description}
            </Paragraph>
          )}
          <Text type="secondary" style={{ fontSize: 11 }}>
            {widgets.length} 个 widget · 更新于{' '}
            {new Date(dashboard.updatedAt).toLocaleString('zh-CN')}
          </Text>
        </div>
        <Space>
          <Button
            type="primary"
            ghost
            icon={<ThunderboltOutlined />}
            disabled={widgets.length === 0}
            onClick={() => setInterpretOpen(true)}
          >
            🧠 AI 解读
          </Button>
          <Button icon={<SyncOutlined />} onClick={refreshAll} loading={refreshingIds.size > 0}>
            全部刷新
          </Button>
          <Button icon={<MessageOutlined />} onClick={() => router.push('/chat')}>
            回 Chat 加 widget
          </Button>
        </Space>
      </div>

      {widgets.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <Empty
            description={
              <Space direction="vertical">
                <Text>还没有 widget</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  去 Chat 分析数据 → 满意的结果点「💾 存到看板」→ 就会出现在这
                </Text>
              </Space>
            }
          >
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => router.push('/chat')}
            >
              去 Chat 分析
            </Button>
          </Empty>
        </Card>
      ) : (
        <WidgetGrid
          widgets={widgets}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          renderWidget={(w) => (
            <Card
              size="small"
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              styles={{
                body: {
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                },
              }}
              title={
                // rgl-drag-handle：仅这个区域可拖，避免按钮误触发
                <div className="rgl-drag-handle" style={{ cursor: 'move' }}>
                  <Space size={6}>
                    <Text strong>{w.title}</Text>
                    <Tag color="blue">{w.chartConfig.type}</Tag>
                  </Space>
                </div>
              }
              extra={
                <Space size={4}>
                  <Tooltip title="🧠 AI 解读本图">
                    <Button
                      type="text"
                      size="small"
                      icon={<BulbOutlined style={{ color: '#faad14' }} />}
                      onClick={() => setInterpretingWidget(w)}
                    />
                  </Tooltip>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        {
                          key: 'display-xlsx',
                          label: '📊 图表数据 · Excel',
                          onClick: () => void downloadWidget(w, 'xlsx', 'display'),
                        },
                        {
                          key: 'display-csv',
                          label: '📊 图表数据 · CSV',
                          onClick: () => void downloadWidget(w, 'csv', 'display'),
                        },
                        { type: 'divider' as const },
                        {
                          key: 'detail-xlsx',
                          label: '📋 明细数据 · Excel（AI 脱聚合）',
                          onClick: () => void downloadWidget(w, 'xlsx', 'detail'),
                        },
                        {
                          key: 'detail-csv',
                          label: '📋 明细数据 · CSV（AI 脱聚合）',
                          onClick: () => void downloadWidget(w, 'csv', 'detail'),
                        },
                      ],
                    }}
                  >
                    <Tooltip title="图表数据 = 跟图一致；明细数据 = AI 脱聚合拿底表原始每行">
                      <Button type="text" size="small" icon={<DownloadOutlined />} />
                    </Tooltip>
                  </Dropdown>
                  <Tooltip title="改标题/图表类型/参数">
                    <Button
                      type="text"
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={() => setSettingsWidget(w)}
                    />
                  </Tooltip>
                  <Tooltip title="刷新数据">
                    <Button
                      type="text"
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={refreshingIds.has(w.id)}
                      onClick={() => void refreshWidget(w)}
                    />
                  </Tooltip>
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeWidget(w)}
                    />
                  </Tooltip>
                </Space>
              }
            >
              {w.description && (
                <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  {w.description}
                </Paragraph>
              )}
              {w.params && w.params.length > 0 && (
                <WidgetInlineFilter
                  params={w.params}
                  values={widgetFilters[w.id] || {}}
                  onChange={(next) => handleInlineFilterChange(w, next)}
                />
              )}
              <WidgetRenderer widget={w} />
              {w.resultSnapshot && (
                <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 6 }}>
                  最近刷新：
                  {new Date(w.resultSnapshot.refreshedAt).toLocaleString('zh-CN')} ·{' '}
                  {w.resultSnapshot.rowCount} 行
                </Text>
              )}
            </Card>
          )}
        />
      )}

      {dashboard && (
        <InterpretDrawer
          open={interpretOpen}
          onClose={() => setInterpretOpen(false)}
          dashboardId={dashboard.id}
          dashboardName={dashboard.name}
          paramValues={{}}
        />
      )}

      {settingsWidget && (
        <WidgetSettingsModal
          open={!!settingsWidget}
          widget={settingsWidget}
          onClose={() => setSettingsWidget(null)}
          onUpdated={(updated) => {
            setWidgets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          }}
        />
      )}

      <WidgetInterpretDrawer
        open={!!interpretingWidget}
        widget={interpretingWidget}
        onClose={() => setInterpretingWidget(null)}
      />
    </Layout.Content>
  );
}
