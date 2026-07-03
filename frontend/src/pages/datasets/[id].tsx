/**
 * /datasets/[id] — 数据集详情页
 *
 * 功能：
 *   - 看完整 schema 表（含 sample / nullRatio / 列描述）
 *   - 行内编辑：列描述（关键！LLM 准确度取决于此）+ 跳过开关
 *   - 编辑：displayName / description（meta info）
 *   - 失败时显示 errorMessage 全文
 *   - 删除按钮（带确认）
 *   - 改归属（转移到另一 project）
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Empty,
  Input,
  Layout,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  ReloadOutlined,
  SaveOutlined,
  ShareAltOutlined,
  UserOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import { UserDataset, DatasetColumn } from '@/types';
import { datasetService, projectService, Project } from '@/services';
import { authStorage } from '@/lib/auth-storage';

const { Text, Paragraph, Title } = Typography;

export default function DatasetDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { message, modal } = App.useApp();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const user = mounted ? authStorage.getUser() : null;

  const [dataset, setDataset] = useState<UserDataset | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 可编辑字段
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<DatasetColumn[]>([]);

  const refresh = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const [ds, ps] = await Promise.all([
        datasetService.get(id),
        projectService.list(),
      ]);
      setDataset(ds);
      setProjects(ps);
      setDisplayName(ds.displayName);
      setDescription(ds.description || '');
      setColumns(ds.columns || []);
      setDirty(false);
    } catch (err: any) {
      message.error(`加载失败：${err.response?.data?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !dataset) {
    return (
      <Layout.Content style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <Spin />
      </Layout.Content>
    );
  }
  if (!dataset) {
    return (
      <Layout.Content style={{ padding: 24 }}>
        <Result status="404" title="数据集不存在" />
      </Layout.Content>
    );
  }

  const isOwner = dataset.ownerId === user?.id;
  const project = projects.find((p) => p.id === dataset.projectId);

  const updateColumn = (idx: number, patch: Partial<DatasetColumn>) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!dataset || !isOwner) return;
    setSaving(true);
    try {
      // 列编辑（描述/跳过）通过 update 接口透传
      await datasetService.update(dataset.id, {
        displayName: displayName.trim() || dataset.displayName,
        description: description.trim() || undefined,
        // 注意：列名/类型一旦入库不可改（影响物理表）
        // 仅允许改 description 和 skipped（实际我们只改 description；skipped 改了不会影响已入库的）
        ...({ columns } as any),
      });
      message.success('已保存');
      await refresh();
    } catch (err: any) {
      message.error(`保存失败：${err.response?.data?.message || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    modal.confirm({
      title: '删除数据集？',
      content: (
        <div>
          <p>
            将永久删除 <b>{dataset.displayName}</b> 和对应物理表
          </p>
          <Text type="warning">⚠️ 不可恢复</Text>
          {project && !project.isPersonalWorkspace && (
            <p>
              <Text type="warning">
                此数据集在项目 <b>{project.name}</b> 中，删除后所有成员都将失去访问
              </Text>
            </p>
          )}
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await datasetService.delete(dataset.id);
          message.success('已删除');
          router.push('/datasets');
        } catch (err: any) {
          message.error(`删除失败：${err.response?.data?.message || err.message}`);
        }
      },
    });
  };

  const handleTransfer = () => {
    let newProjectId: string | null = dataset.projectId;
    let select: Project | undefined;
    modal.confirm({
      title: (
        <Space>
          <ShareAltOutlined />
          转移到其他项目
        </Space>
      ),
      icon: null,
      content: (
        <div>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            转移后数据集归属新项目，对话权限随之变化
          </Paragraph>
          <Select
            defaultValue={dataset.projectId}
            onChange={(v) => {
              newProjectId = v;
              select = projects.find((p) => p.id === v);
            }}
            style={{ width: '100%' }}
            options={projects.map((p) => ({
              value: p.id,
              label: (
                <Space>
                  {p.isPersonalWorkspace ? <UserOutlined /> : <TeamOutlined />}
                  {p.name}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {p.isPersonalWorkspace ? '仅自己' : `${p.memberCount} 人`}
                  </Text>
                </Space>
              ),
            }))}
          />
        </div>
      ),
      okText: '转移',
      onOk: async () => {
        if (newProjectId === dataset.projectId) {
          message.info('归属未变');
          return;
        }
        // 共享给团队 project 需二次确认
        if (select && !select.isPersonalWorkspace) {
          await new Promise<void>((resolve, reject) => {
            modal.confirm({
              title: '⚠️ 共享数据集到团队项目',
              content: (
                <p>
                  项目 <b>{select?.name}</b> 的 <b>{select?.memberCount}</b> 位成员都将能查询此数据集
                </p>
              ),
              okText: '确认共享',
              onOk: () => resolve(),
              onCancel: () => reject(),
            });
          });
        }
        await datasetService.update(dataset.id, { projectId: newProjectId });
        message.success('已转移');
        await refresh();
      },
    });
  };

  const statusTag = () => {
    const map: Record<string, { color: string; text: string }> = {
      pending: { color: 'default', text: '等待解析' },
      parsing: { color: 'processing', text: '解析中' },
      awaiting_confirm: { color: 'gold', text: '待确认' },
      importing: { color: 'processing', text: '入库中' },
      ready: { color: 'success', text: '可分析' },
      failed: { color: 'error', text: '失败' },
    };
    const m = map[dataset.status];
    return <Tag color={m.color}>{m.text}</Tag>;
  };

  return (
    <Layout.Content style={{ padding: '24px 32px', background: '#fff', minHeight: '100vh' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/datasets')}
          type="text"
        >
          返回
        </Button>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space direction="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}>
            {isOwner ? (
              <Input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setDirty(true);
                }}
                bordered={false}
                style={{ fontSize: 24, fontWeight: 600, padding: 0 }}
                maxLength={255}
              />
            ) : (
              displayName
            )}
          </Title>
          <Space>
            {statusTag()}
            <Text type="secondary">{dataset.sourceFilename}</Text>
            <Text type="secondary">·</Text>
            <Text type="secondary">{dataset.rowCount?.toLocaleString() ?? '—'} 行</Text>
          </Space>
        </Space>
        <Space>
          {dataset.status === 'ready' && (
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => router.push(`/chat?projectId=${dataset.projectId}&datasetId=${dataset.id}`)}
            >
              到 Chat 分析
            </Button>
          )}
          {isOwner && (
            <>
              {dirty && (
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={saving}
                >
                  保存修改
                </Button>
              )}
              <Button icon={<ShareAltOutlined />} onClick={handleTransfer}>
                转移
              </Button>
              <Button icon={<ReloadOutlined />} onClick={refresh}>
                刷新
              </Button>
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                删除
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* 失败错误诊断 */}
      {dataset.status === 'failed' && dataset.errorMessage && (
        <Alert
          type="error"
          showIcon
          message="入库失败"
          description={
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                fontFamily: 'monospace',
                margin: 0,
                color: '#a8071a',
              }}
            >
              {dataset.errorMessage}
            </pre>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 元信息 */}
      <Descriptions
        bordered
        size="small"
        column={2}
        style={{ marginBottom: 24 }}
      >
        <Descriptions.Item label="归属项目">
          <Space>
            {project?.isPersonalWorkspace ? <UserOutlined /> : <TeamOutlined />}
            {project?.name || '—'}
            {project && !project.isPersonalWorkspace && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {project.memberCount} 位成员
              </Text>
            )}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="物理表">
          <code style={{ fontSize: 12 }}>
            {dataset.tableName ? `user_data.${dataset.tableName}` : '—'}
          </code>
        </Descriptions.Item>
        <Descriptions.Item label="文件大小">
          {(dataset.sourceSizeBytes / 1024).toFixed(1)} KB
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {new Date(dataset.createdAt).toLocaleString('zh-CN')}
        </Descriptions.Item>
        <Descriptions.Item label="业务描述" span={2}>
          {isOwner ? (
            <Input.TextArea
              placeholder="给 AI 看的整体描述，如『2024 年订单流水，customer_id 为脱敏 ID』..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
              rows={2}
              maxLength={2000}
            />
          ) : (
            description || <Text type="secondary">—</Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      <Title level={4} style={{ marginTop: 0 }}>
        <Space>
          <EditOutlined />
          表结构
          <Text type="secondary" style={{ fontSize: 13, fontWeight: 'normal' }}>
            ({columns.filter((c) => !c.skipped).length} 列入库 / 共 {columns.length} 列)
          </Text>
        </Space>
      </Title>
      <Alert
        type="info"
        showIcon
        message="为列写业务描述能大幅提升 AI 分析准确性"
        description="例如：把 cust_id 描述为「客户 ID，可关联 customers.id」，AI 会自动识别 JOIN 关系"
        style={{ marginBottom: 12 }}
        closable
      />

      {columns.length === 0 ? (
        <Empty description="尚未解析出列结构" />
      ) : (
        <Table
          rowKey="name"
          size="small"
          pagination={false}
          dataSource={columns}
          columns={[
            {
              title: '入库',
              width: 60,
              align: 'center',
              render: (_, _c, idx) => (
                <Switch
                  size="small"
                  checked={!columns[idx].skipped}
                  disabled={!isOwner || dataset.status !== 'ready'}
                  onChange={(checked) =>
                    updateColumn(idx, { skipped: !checked })
                  }
                />
              ),
            },
            {
              title: '列名',
              dataIndex: 'name',
              width: 180,
              render: (name, c) => (
                <Space direction="vertical" size={0}>
                  <code style={{ fontSize: 13 }}>{name}</code>
                  {c.originalName && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      原：{c.originalName}
                    </Text>
                  )}
                </Space>
              ),
            },
            {
              title: '类型',
              dataIndex: 'type',
              width: 100,
              render: (t) => <Tag>{t}</Tag>,
            },
            {
              title: (
                <Tooltip title="给 AI 的列含义说明 — 影响分析准确度">
                  业务描述
                  <Text type="secondary" style={{ marginLeft: 4 }}>
                    *
                  </Text>
                </Tooltip>
              ),
              dataIndex: 'description',
              render: (desc, _c, idx) =>
                isOwner ? (
                  <Input
                    size="small"
                    placeholder="给 AI 看的说明..."
                    value={desc || ''}
                    onChange={(e) => updateColumn(idx, { description: e.target.value })}
                    maxLength={500}
                    disabled={columns[idx].skipped}
                  />
                ) : (
                  <span>{desc || <Text type="secondary">—</Text>}</span>
                ),
            },
            {
              title: '示例',
              width: 200,
              render: (_, c) => (
                <Tooltip
                  title={(c.sample || []).slice(0, 5).join(', ') || '(空)'}
                >
                  <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                    {(c.sample || []).slice(0, 2).map((s) => String(s).substring(0, 20)).join(', ') || '—'}
                  </Text>
                </Tooltip>
              ),
            },
            {
              title: '空率',
              width: 70,
              align: 'right',
              render: (_, c) =>
                typeof c.nullRatio === 'number' ? (
                  <Tag color={c.nullRatio > 0.3 ? 'orange' : 'default'}>
                    {Math.round(c.nullRatio * 100)}%
                  </Tag>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      )}

      {dirty && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: '#fffbe6',
            padding: 12,
            margin: '16px -32px -24px',
            borderTop: '1px solid #ffe58f',
            textAlign: 'right',
          }}
        >
          <Space>
            <Text type="warning">⚠️ 有未保存的修改</Text>
            <Button onClick={refresh}>放弃</Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              保存
            </Button>
          </Space>
        </div>
      )}
    </Layout.Content>
  );
}
