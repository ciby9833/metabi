/**
 * /datasets — 我的数据列表页（按 Project 分组，学 Claude Project Knowledge）
 *
 * 设计：
 *   - 每个 Project 一个 Card，里面列出该 Project 下的所有 dataset
 *   - 行点击 → /datasets/[id] 详情页（看完整 schema / 编辑列描述 / 转移）
 *   - 失败行：Tooltip 显示 errorMessage；删除按钮显眼
 *   - importing 状态自动 2s 轮询
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Layout,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  LoadingOutlined,
  MessageOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import { UserDataset, DatasetStatus } from '@/types';
import { datasetService, projectService, Project } from '@/services';
import { authStorage } from '@/lib/auth-storage';
import { UploadWizard } from '@/components/dataset/UploadWizard';

const { Text, Title } = Typography;

const STATUS_META: Record<
  DatasetStatus,
  { color: string; label: string; icon?: React.ReactNode }
> = {
  pending: { color: 'default', label: '等待解析' },
  parsing: { color: 'processing', label: '正在解析', icon: <LoadingOutlined /> },
  awaiting_confirm: { color: 'gold', label: '待确认' },
  importing: { color: 'processing', label: '入库中', icon: <LoadingOutlined /> },
  ready: { color: 'success', label: '可分析' },
  failed: { color: 'error', label: '失败' },
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function DatasetsPage() {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const user = mounted ? authStorage.getUser() : null;

  const [datasets, setDatasets] = useState<UserDataset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDefaultProject, setWizardDefaultProject] = useState<string | null>(null);
  const pollTimer = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ds, ps] = await Promise.all([
        datasetService.list(),
        projectService.list(),
      ]);
      setDatasets(ds);
      setProjects(ps);
    } catch (err: any) {
      message.error(`加载失败：${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有 importing / parsing 的 dataset → 2s 轮询直到全 ready
  useEffect(() => {
    const inProgress = datasets.some(
      (d) => d.status === 'importing' || d.status === 'parsing',
    );
    if (inProgress && !pollTimer.current) {
      pollTimer.current = setInterval(() => void refresh(), 2000);
    } else if (!inProgress && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [datasets, refresh]);

  // 按 project 分组
  const grouped = useMemo(() => {
    const map = new Map<string, { project: Project; datasets: UserDataset[] }>();
    // 先把所有 project 都加进来（即使空）— 让用户看到 "personal workspace"
    projects.forEach((p) => map.set(p.id, { project: p, datasets: [] }));
    datasets.forEach((d) => {
      const entry = map.get(d.projectId);
      if (entry) entry.datasets.push(d);
    });
    // 按：先 personal workspace，再 owner（按 memberCount 倒序），最后参与的
    return Array.from(map.values()).sort((a, b) => {
      if (a.project.isPersonalWorkspace) return -1;
      if (b.project.isPersonalWorkspace) return 1;
      return (b.project.memberCount || 0) - (a.project.memberCount || 0);
    });
  }, [projects, datasets]);

  const handleDelete = (ds: UserDataset) => {
    if (ds.ownerId !== user?.id) {
      message.warning('只有 owner 可以删除');
      return;
    }
    const project = projects.find((p) => p.id === ds.projectId);
    modal.confirm({
      title: '删除数据集？',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>
            将永久删除 <b>{ds.displayName}</b>（{ds.rowCount ?? '?'} 行）和对应物理表
          </p>
          <Text type="warning">⚠️ 不可恢复</Text>
          {project && !project.isPersonalWorkspace && (
            <p style={{ marginTop: 8 }}>
              <Text type="warning">
                此数据集在项目 <b>{project.name}</b> 中，删除后所有成员都将失去访问
              </Text>
            </p>
          )}
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await datasetService.delete(ds.id);
          message.success('已删除');
          await refresh();
        } catch (err: any) {
          message.error(`删除失败：${err.response?.data?.message || err.message}`);
        }
      },
    });
  };

  const handleChat = (ds: UserDataset) => {
    router.push(`/chat?projectId=${ds.projectId}&datasetId=${ds.id}`);
  };

  const openUpload = (projectId?: string) => {
    setWizardDefaultProject(projectId || null);
    setWizardOpen(true);
  };

  const buildColumns = (project: Project): ColumnsType<UserDataset> => [
    {
      title: '名称',
      dataIndex: 'displayName',
      render: (name, ds) => (
        <a onClick={() => router.push(`/datasets/${ds.id}`)}>
          <Space direction="vertical" size={2}>
            <Text strong>{name}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {ds.sourceFilename}
            </Text>
          </Space>
        </a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: DatasetStatus, ds) => {
        const m = STATUS_META[s];
        const tag = (
          <Tag color={m.color} icon={m.icon}>
            {m.label}
          </Tag>
        );
        if (s === 'failed' && ds.errorMessage) {
          return (
            <Tooltip
              title={
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: 0 }}>
                  {ds.errorMessage}
                </pre>
              }
              placement="topLeft"
              styles={{ root: { maxWidth: 480 } }}
            >
              {tag}
            </Tooltip>
          );
        }
        return tag;
      },
    },
    {
      title: '行数',
      width: 100,
      render: (_, ds) => (
        <Text>{ds.rowCount?.toLocaleString() ?? '—'}</Text>
      ),
    },
    {
      title: '大小',
      width: 90,
      render: (_, ds) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatBytes(ds.sourceSizeBytes)}
        </Text>
      ),
    },
    {
      title: '列数',
      width: 70,
      render: (_, ds) => ds.columns?.filter((c) => !c.skipped).length ?? '—',
    },
    {
      title: '创建',
      width: 140,
      render: (_, ds) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(ds.createdAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      ),
    },
    {
      title: '操作',
      width: 240,
      align: 'right',
      render: (_, ds) => {
        const isOwner = ds.ownerId === user?.id;
        const ready = ds.status === 'ready';
        return (
          <Space size={4}>
            <Tooltip title={ready ? '到 Chat 分析' : '入库完成后可分析'}>
              <Button
                type="link"
                size="small"
                icon={<MessageOutlined />}
                onClick={() => handleChat(ds)}
                disabled={!ready}
              >
                Chat
              </Button>
            </Tooltip>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => router.push(`/datasets/${ds.id}`)}
            >
              详情
            </Button>
            {isOwner && (
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(ds)}
              >
                删除
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Layout.Content style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            我的数据
          </Title>
          <Text type="secondary">
            按项目组织数据集 — 同一项目下的多个表可在 Chat 里自动 JOIN
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refresh()} loading={loading}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => openUpload()}
            size="large"
          >
            上传数据集
          </Button>
        </Space>
      </Space>

      <Alert
        type="info"
        showIcon
        message="数据安全 + 项目隔离"
        description="AI 对话受白名单严格限制，跨项目无法访问。默认上传到「我的工作区」（仅自己可见）；如需团队共享，可上传到团队项目或在详情页转移。"
        style={{ marginBottom: 16 }}
        closable
      />

      {loading && grouped.length === 0 ? null : grouped.length === 0 ? (
        <Empty description="还没有任何项目，请先创建一个项目" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {grouped.map(({ project, datasets: dsList }) => (
            <Card
              key={project.id}
              size="small"
              title={
                <Space>
                  {project.isPersonalWorkspace ? (
                    <UserOutlined style={{ color: '#1677ff' }} />
                  ) : (
                    <FolderOutlined style={{ color: '#faad14' }} />
                  )}
                  <span style={{ fontWeight: 500 }}>{project.name}</span>
                  {project.isPersonalWorkspace ? (
                    <Tag>仅自己</Tag>
                  ) : (
                    <Tooltip title={`${project.memberCount} 位成员可访问`}>
                      <Tag icon={<TeamOutlined />} color="gold">
                        {project.memberCount} 人
                      </Tag>
                    </Tooltip>
                  )}
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                    {dsList.length} 个数据集
                  </Text>
                </Space>
              }
              extra={
                <Space>
                  <Button
                    type="link"
                    size="small"
                    icon={<CloudUploadOutlined />}
                    onClick={() => openUpload(project.id)}
                  >
                    上传到此项目
                  </Button>
                </Space>
              }
              style={{
                borderColor: project.isPersonalWorkspace ? '#e6f4ff' : '#fff7e6',
              }}
            >
              {dsList.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="该项目下还没有数据集"
                  style={{ padding: '16px 0' }}
                >
                  <Button
                    type="link"
                    icon={<CloudUploadOutlined />}
                    onClick={() => openUpload(project.id)}
                  >
                    上传第一个数据集
                  </Button>
                </Empty>
              ) : (
                <Table
                  rowKey="id"
                  columns={buildColumns(project)}
                  dataSource={dsList}
                  size="small"
                  pagination={false}
                  rowClassName={(ds) => (ds.status === 'failed' ? 'dataset-row-failed' : '')}
                />
              )}
            </Card>
          ))}
        </Space>
      )}

      <UploadWizard
        open={wizardOpen}
        defaultProjectId={wizardDefaultProject || undefined}
        onClose={() => setWizardOpen(false)}
        onDone={() => {
          void refresh();
        }}
      />

      <style jsx global>{`
        .dataset-row-failed {
          background: #fff1f0;
        }
        .dataset-row-failed:hover > td {
          background: #ffe5e3 !important;
        }
      `}</style>
    </Layout.Content>
  );
}
