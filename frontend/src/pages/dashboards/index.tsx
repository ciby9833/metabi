/**
 * /dashboards — 我的看板列表（按归属分组）
 *
 *   - 「我的个人看板」（projectId=null 且 owner=我）
 *   - 每个参与的 Project 一个组
 *   - 卡片式展示；点击 → 详情页；有删除/新建按钮
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  DashboardOutlined,
  DeleteOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import { dashboardService, projectService, Dashboard, Project } from '@/services';
import { authStorage } from '@/lib/auth-storage';

const { Text, Title, Paragraph } = Typography;

export default function DashboardsPage() {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const user = mounted ? authStorage.getUser() : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ds, ps] = await Promise.all([dashboardService.list(), projectService.list()]);
      setDashboards(ds);
      setProjects(ps);
    } catch (err: any) {
      message.error(`加载失败：${err.response?.data?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const personal: Dashboard[] = [];
    const byProject = new Map<string, Dashboard[]>();
    for (const d of dashboards) {
      if (!d.projectId) personal.push(d);
      else {
        if (!byProject.has(d.projectId)) byProject.set(d.projectId, []);
        byProject.get(d.projectId)!.push(d);
      }
    }
    return { personal, byProject };
  }, [dashboards]);

  const handleCreate = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const v = form.getFieldsValue();
    try {
      const d = await dashboardService.create({
        name: v.name.trim(),
        description: v.description?.trim() || undefined,
        icon: v.icon?.trim() || undefined,
        projectId: v.projectId || null,
      });
      message.success('已创建');
      setCreateOpen(false);
      form.resetFields();
      router.push(`/dashboards/${d.id}`);
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message);
    }
  };

  const handleDelete = (d: Dashboard) => {
    if (d.ownerId !== user?.id) {
      message.warning('仅创建者可删除');
      return;
    }
    modal.confirm({
      title: '删除看板？',
      content: (
        <div>
          <p>
            将永久删除 <b>{d.name}</b> 及其所有 widgets
          </p>
          <Text type="warning">⚠️ 不可恢复</Text>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await dashboardService.remove(d.id);
          message.success('已删除');
          await load();
        } catch (err: any) {
          message.error(err.response?.data?.message || err.message);
        }
      },
    });
  };

  const renderCards = (list: Dashboard[]) =>
    list.length === 0 ? (
      <Empty description="还没有看板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    ) : (
      <Space size={[12, 12]} wrap>
        {list.map((d) => (
          <Card
            key={d.id}
            hoverable
            style={{ width: 260, height: 130 }}
            styles={{ body: { padding: 14 } }}
            onClick={() => router.push(`/dashboards/${d.id}`)}
          >
            <Space
              direction="vertical"
              size={4}
              style={{ width: '100%', height: '100%', justifyContent: 'space-between' }}
            >
              <div>
                <Space>
                  <span style={{ fontSize: 20 }}>{d.icon || '📊'}</span>
                  <Text strong ellipsis style={{ maxWidth: 160 }}>
                    {d.name}
                  </Text>
                </Space>
                <Paragraph
                  type="secondary"
                  style={{ fontSize: 12, margin: '4px 0 0' }}
                  ellipsis={{ rows: 2 }}
                >
                  {d.description || '—'}
                </Paragraph>
              </div>
              <Space size={4} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {new Date(d.updatedAt).toLocaleDateString('zh-CN')}
                </Text>
                {d.ownerId === user?.id && (
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(d);
                    }}
                  />
                )}
              </Space>
            </Space>
          </Card>
        ))}
      </Space>
    );

  return (
    <Layout.Content style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Space
        style={{ marginBottom: 20, width: '100%', justifyContent: 'space-between' }}
        align="start"
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <DashboardOutlined /> 我的看板
          </Title>
          <Text type="secondary">
            把 chat 里的分析结果固化成看板，反复查看 · 团队共享
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            size="large"
          >
            新建看板
          </Button>
        </Space>
      </Space>

      {/* 个人看板 */}
      <Card
        size="small"
        title={
          <Space>
            <UserOutlined style={{ color: '#1677ff' }} /> 个人看板
            <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
              仅自己可见
            </Text>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {renderCards(grouped.personal)}
      </Card>

      {/* 各 project 看板 */}
      {Array.from(grouped.byProject.entries()).map(([pid, list]) => {
        const proj = projects.find((p) => p.id === pid);
        return (
          <Card
            key={pid}
            size="small"
            title={
              <Space>
                <FolderOutlined style={{ color: '#faad14' }} />
                {proj?.name || pid.substring(0, 8)}
                <Tag color="gold">{proj?.memberCount ?? '?'} 人</Tag>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {renderCards(list)}
          </Card>
        );
      })}

      {/* 新建 Modal */}
      <Modal
        open={createOpen}
        title="新建看板"
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
      >
        <Form form={form} layout="vertical" initialValues={{ icon: '📊' }}>
          <Form.Item name="name" label="看板名" rules={[{ required: true }]}>
            <Input placeholder="如：5月运单每日复盘" maxLength={255} />
          </Form.Item>
          <Form.Item name="icon" label="图标（emoji）">
            <Input placeholder="📊" maxLength={4} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="给团队看的一句话说明" maxLength={500} />
          </Form.Item>
          <Form.Item
            name="projectId"
            label="归属"
            tooltip="不选 = 个人看板；选 project = 项目内共享"
          >
            <Select
              placeholder="个人看板（默认）"
              allowClear
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.memberCount || 1} 人)`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout.Content>
  );
}
