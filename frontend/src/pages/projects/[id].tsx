import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  App,
  Avatar,
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  ProjectOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Project, ProjectMember, projectService, datasetService } from '@/services';
import { UserDataset } from '@/types';
import { UploadWizard } from '@/components/dataset/UploadWizard';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

const roleColors: Record<string, string> = {
  owner: 'gold',
  admin: 'volcano',
  editor: 'blue',
  viewer: 'default',
};

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { message, modal } = App.useApp();
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingInstr, setSavingInstr] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [profileForm] = Form.useForm();
  const [instrForm] = Form.useForm();
  const [inviteForm] = Form.useForm();

  // 项目下的数据集（Project Knowledge）
  const [datasets, setDatasets] = useState<UserDataset[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const [p, ms, allDs] = await Promise.all([
        projectService.get(id),
        projectService.listMembers(id),
        datasetService.list(),
      ]);
      setProject(p);
      setMembers(ms);
      setDatasets(allDs.filter((d) => d.projectId === id));
      profileForm.setFieldsValue({
        name: p.name,
        icon: p.icon || '',
        description: p.description || '',
      });
      instrForm.setFieldsValue({ systemInstructions: p.systemInstructions || '' });
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !project) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const canEdit = project.myRole === 'owner' || project.myRole === 'admin';

  const onSaveProfile = async () => {
    try {
      await profileForm.validateFields();
    } catch {
      return;
    }
    setSavingProfile(true);
    try {
      const v = profileForm.getFieldsValue();
      const updated = await projectService.update(project.id, v);
      setProject({ ...project, ...updated });
      message.success('已保存');
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const onSaveInstr = async () => {
    setSavingInstr(true);
    try {
      const v = instrForm.getFieldsValue();
      const updated = await projectService.update(project.id, {
        systemInstructions: v.systemInstructions,
      });
      setProject({ ...project, ...updated });
      message.success('已保存。后续此项目下的对话都会自动注入新指令');
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSavingInstr(false);
    }
  };

  const onInvite = async () => {
    try {
      await inviteForm.validateFields();
    } catch {
      return;
    }
    setInviting(true);
    try {
      const v = inviteForm.getFieldsValue();
      await projectService.invite(project.id, v.email, v.role);
      message.success('已邀请');
      setInviteOpen(false);
      inviteForm.resetFields();
      await load();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setInviting(false);
    }
  };

  const onRemoveMember = async (m: ProjectMember) => {
    try {
      await projectService.removeMember(project.id, m.id);
      message.success('已移除');
      await load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const onChangeRole = async (m: ProjectMember, newRole: 'admin' | 'editor' | 'viewer') => {
    try {
      await projectService.updateMemberRole(project.id, m.id, newRole);
      message.success('角色已更新');
      await load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const onDeleteProject = () => {
    modal.confirm({
      title: `确认删除项目「${project.name}」？`,
      content: '不可恢复。项目下的对话不会被删除（projectId 设为 null）。',
      okType: 'danger',
      onOk: async () => {
        try {
          await projectService.remove(project.id);
          message.success('已删除');
          void router.replace('/projects');
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Link href="/projects">
          <Button icon={<ArrowLeftOutlined />}>返回项目列表</Button>
        </Link>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Space size={16} align="start" style={{ width: '100%' }}>
          <Avatar size={56} style={{ background: '#1677ff', fontSize: 22 }} icon={!project.icon && <ProjectOutlined />}>
            {project.icon}
          </Avatar>
          <div style={{ flex: 1 }}>
            <Title level={4} style={{ margin: 0 }}>
              {project.name}{' '}
              <Tag color={roleColors[project.myRole]}>
                {project.myRole === 'owner' && <CrownOutlined />} {project.myRole}
              </Tag>
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {project.description || '—'}
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12 }}>
              创建于 {dayjs(project.createdAt).format('YYYY-MM-DD')}　|　最近更新{' '}
              {dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}
            </Text>
          </div>
          {project.myRole === 'owner' && (
            <Button danger icon={<DeleteOutlined />} onClick={onDeleteProject}>
              删除项目
            </Button>
          )}
        </Space>
      </Card>

      <Tabs
        defaultActiveKey="instr"
        items={[
          {
            key: 'instr',
            label: (
              <span>
                <EditOutlined /> 项目指令
              </span>
            ),
            children: (
              <Card>
                <Paragraph type="secondary">
                  这段文字会自动注入到此项目下<Text strong>每次 Agent 推理</Text>的 system prompt。
                  写口径偏好、回答风格、上下文背景等，避免每次对话都重复说。
                </Paragraph>
                <Form form={instrForm} layout="vertical" disabled={!canEdit}>
                  <Form.Item name="systemInstructions">
                    <Input.TextArea
                      autoSize={{ minRows: 10, maxRows: 30 }}
                      placeholder={`你正在协助 XXX 业务团队。
- 数据时间范围：2026 Q3
- 单量口径：成单订单（distinct waybill_no）
- 回答风格：简洁，先结论后细节
- 如果用户问"为什么"，主动用 decompose_by_dimensions`}
                      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                    />
                  </Form.Item>
                  {canEdit && (
                    <Button type="primary" onClick={onSaveInstr} loading={savingInstr}>
                      保存指令
                    </Button>
                  )}
                </Form>
              </Card>
            ),
          },
          {
            key: 'members',
            label: (
              <span>
                <TeamOutlined /> 成员 ({members.length})
              </span>
            ),
            children: (
              <Card
                extra={
                  canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteOpen(true)}>
                      邀请成员
                    </Button>
                  )
                }
              >
                <List
                  dataSource={members}
                  renderItem={(m) => (
                    <List.Item
                      actions={
                        canEdit && m.role !== 'owner'
                          ? [
                              <Select
                                key="role"
                                size="small"
                                value={m.role}
                                style={{ width: 100 }}
                                onChange={(v) => onChangeRole(m, v as any)}
                                options={[
                                  { value: 'admin', label: 'admin' },
                                  { value: 'editor', label: 'editor' },
                                  { value: 'viewer', label: 'viewer' },
                                ]}
                              />,
                              <Popconfirm
                                key="del"
                                title={`移除 ${m.user?.name}？`}
                                onConfirm={() => onRemoveMember(m)}
                              >
                                <Button size="small" danger>
                                  移除
                                </Button>
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
                      <List.Item.Meta
                        avatar={
                          <Avatar
                            src={m.user?.avatarUrl || undefined}
                            icon={!m.user?.avatarUrl && <UserOutlined />}
                            style={{ background: '#1677ff' }}
                          />
                        }
                        title={
                          <Space>
                            <Text>{m.user?.name || '(已删除用户)'}</Text>
                            <Tag color={roleColors[m.role]}>
                              {m.role === 'owner' && <CrownOutlined />} {m.role}
                            </Tag>
                          </Space>
                        }
                        description={m.user?.email}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
          {
            key: 'datasets',
            label: (
              <span>
                <DatabaseOutlined /> 数据集 ({datasets.length})
              </span>
            ),
            children: (
              <Card
                title={
                  <Space>
                    <Text>Project Knowledge — 同项目下的数据集可在 Chat 自动 JOIN</Text>
                  </Space>
                }
                extra={
                  canEdit && (
                    <Button
                      type="primary"
                      icon={<CloudUploadOutlined />}
                      onClick={() => setUploadOpen(true)}
                    >
                      上传数据集
                    </Button>
                  )
                }
              >
                {datasets.length === 0 ? (
                  <div style={{ padding: '32px 0', textAlign: 'center' }}>
                    <DatabaseOutlined style={{ fontSize: 36, color: '#bfbfbf' }} />
                    <Paragraph type="secondary" style={{ marginTop: 12 }}>
                      此项目还没有数据集
                    </Paragraph>
                    {canEdit && (
                      <Button
                        type="primary"
                        icon={<CloudUploadOutlined />}
                        onClick={() => setUploadOpen(true)}
                      >
                        上传第一个数据集
                      </Button>
                    )}
                  </div>
                ) : (
                  <List
                    dataSource={datasets}
                    renderItem={(ds) => {
                      const statusColor: Record<string, string> = {
                        ready: 'success',
                        failed: 'error',
                        importing: 'processing',
                        parsing: 'processing',
                        awaiting_confirm: 'gold',
                        pending: 'default',
                      };
                      return (
                        <List.Item
                          actions={[
                            <Button
                              key="chat"
                              type="link"
                              size="small"
                              icon={<MessageOutlined />}
                              disabled={ds.status !== 'ready'}
                              onClick={() =>
                                router.push(
                                  `/chat?projectId=${ds.projectId}&datasetId=${ds.id}`,
                                )
                              }
                            >
                              Chat
                            </Button>,
                            <Link key="detail" href={`/datasets/${ds.id}`}>
                              <Button type="link" size="small">
                                详情
                              </Button>
                            </Link>,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={<DatabaseOutlined style={{ fontSize: 20, color: '#1677ff' }} />}
                            title={
                              <Space>
                                <Text strong>{ds.displayName}</Text>
                                <Tag color={statusColor[ds.status]}>{ds.status}</Tag>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {ds.rowCount?.toLocaleString() ?? '?'} 行 ·{' '}
                                  {ds.columns?.filter((c) => !c.skipped).length ?? 0} 列
                                </Text>
                              </Space>
                            }
                            description={
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {ds.description || ds.sourceFilename}
                              </Text>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            ),
          },
          {
            key: 'profile',
            label: (
              <span>
                <SettingOutlined /> 基本资料
              </span>
            ),
            children: (
              <Card>
                <Form form={profileForm} layout="vertical" disabled={!canEdit}>
                  <Form.Item name="name" label="项目名" rules={[{ required: true, max: 255 }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="icon" label="图标（emoji）">
                    <Input maxLength={4} />
                  </Form.Item>
                  <Form.Item name="description" label="说明">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  {canEdit && (
                    <Button type="primary" onClick={onSaveProfile} loading={savingProfile}>
                      保存
                    </Button>
                  )}
                </Form>
              </Card>
            ),
          },
        ]}
      />

      <UploadWizard
        open={uploadOpen}
        defaultProjectId={typeof id === 'string' ? id : undefined}
        onClose={() => setUploadOpen(false)}
        onDone={() => {
          void load();
        }}
      />

      <Modal
        title="邀请新成员"
        open={inviteOpen}
        onCancel={() => setInviteOpen(false)}
        onOk={onInvite}
        confirmLoading={inviting}
        okText="邀请"
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          对方必须已经在 ChatBI 注册账号。
        </Paragraph>
        <Form form={inviteForm} layout="vertical">
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="member@example.com" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="editor" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'admin', label: 'admin - 管理项目设置和成员' },
                { value: 'editor', label: 'editor - 可对话、可改设置（默认）' },
                { value: 'viewer', label: 'viewer - 只读' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
