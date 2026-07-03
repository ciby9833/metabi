import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  BookOutlined,
  ReloadOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
  UndoOutlined,
  PoweroffOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  AimOutlined,
} from '@ant-design/icons';
import {
  skillService,
  projectService,
  type SkillDetail,
  type SkillSummary,
  type SkillUpsert,
  type Project,
} from '@/services';

const { Title, Text, Paragraph } = Typography;

const EMPTY_FORM: SkillUpsert & { rowVersion?: number } = {
  name: '',
  version: '1.0.0',
  description: '',
  match: '',
  priority: 0,
  tables: [],
  attributableDimensions: [],
  datasourceTypes: [],
  body: '',
  isActive: true,
  visibility: 'global',
  projectId: null,
};

const VISIBILITY_META: Record<
  'global' | 'project' | 'personal',
  { label: string; color: string; tooltip: string }
> = {
  global: { label: '全局', color: 'blue', tooltip: '所有用户可见' },
  project: { label: '项目', color: 'gold', tooltip: '仅该项目成员可见' },
  personal: { label: '个人', color: 'default', tooltip: '仅自己可见' },
};

export default function SkillsPage() {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<SkillSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SkillDetail | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [form] = Form.useForm();
  // 用于在 visibility=project 时切换 projectId 选择器
  const [formVisibility, setFormVisibility] = useState<'global' | 'project' | 'personal'>('global');

  const load = async () => {
    setLoading(true);
    try {
      const [skills, ps] = await Promise.all([
        skillService.list(includeInactive),
        projectService.list().catch(() => [] as Project[]),
      ]);
      setList(skills);
      setProjects(ps);
    } catch (err) {
      message.error(`加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [includeInactive]);

  const openNew = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(EMPTY_FORM);
    setFormVisibility('global');
    setEditorOpen(true);
  };

  const openEdit = async (name: string) => {
    setEditorLoading(true);
    setEditorOpen(true);
    try {
      const detail = await skillService.getOne(name);
      setEditing(detail);
      form.setFieldsValue({
        name: detail.name,
        version: detail.version,
        description: detail.description,
        match: detail.match || '',
        priority: detail.priority,
        tables: detail.tables || [],
        attributableDimensions: detail.attributableDimensions || [],
        datasourceTypes: detail.datasourceTypes || [],
        body: detail.body,
        isActive: detail.isActive,
        visibility: detail.visibility,
        projectId: detail.projectId || undefined,
      });
      setFormVisibility(detail.visibility);
    } catch (err) {
      message.error(`加载失败: ${(err as Error).message}`);
      setEditorOpen(false);
    } finally {
      setEditorLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue();
    try {
      if (editing) {
        await skillService.update(editing.name, {
          ...values,
          rowVersion: editing.rowVersion,
        });
        message.success('已保存并热重载');
      } else {
        await skillService.create(values);
        message.success('已新建并热重载');
      }
      setEditorOpen(false);
      void load();
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`);
    }
  };

  const handleRollback = async (name: string) => {
    try {
      await skillService.rollback(name);
      message.success('已回滚到上一版');
      void load();
    } catch (err) {
      message.error(`回滚失败: ${(err as Error).message}`);
    }
  };

  const handleDeactivate = async (name: string) => {
    try {
      await skillService.deactivate(name);
      message.success('已停用');
      void load();
    } catch (err) {
      message.error(`停用失败: ${(err as Error).message}`);
    }
  };

  const handleHardDelete = async (name: string) => {
    try {
      await skillService.hardDelete(name);
      message.success('已删除');
      void load();
    } catch (err) {
      message.error(`删除失败: ${(err as Error).message}`);
    }
  };

  const handleReload = async () => {
    try {
      const r = await skillService.reload();
      message.success(`已重载，共 ${r.count} 个 Skill`);
      void load();
    } catch (err) {
      message.error(`重载失败: ${(err as Error).message}`);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <BookOutlined />
            <Title level={4} style={{ margin: 0 }}>
              Skills 管理
            </Title>
            <Tag>{list.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Text type="secondary">含已停用</Text>
            <Switch checked={includeInactive} onChange={setIncludeInactive} size="small" />
            <Button icon={<ReloadOutlined />} onClick={handleReload}>
              强制重载
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
              新建 Skill
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary">
          Skill 现已迁移到数据库存储，前端编辑后 <Text strong>立即生效</Text>，无需重启或重新部署。
          新对话会自动用最新 Skill；旧对话由于已锁定 Skill 不受影响。
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
          💡 <Text strong>行业基准</Text>：在 Skill 正文里加 <Text code>## 行业基准</Text> 段落，
          用户问"行业一般什么水平 / 对标 / 标杆"时 Agent 会自动引用并明示"来源：行业基准库（人工维护）"。
          没有这段时 Agent 会拒答而不是幻觉数字。
        </Paragraph>

        <List
          loading={loading}
          dataSource={list}
          renderItem={(s) => (
            <List.Item
              style={{ opacity: s.isActive ? 1 : 0.55 }}
              actions={[
                <Button
                  key="edit"
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(s.name)}
                >
                  编辑
                </Button>,
                s.hasRollback && (
                  <Popconfirm
                    key="rollback"
                    title="回滚到上一版？"
                    onConfirm={() => handleRollback(s.name)}
                  >
                    <Button type="link" icon={<UndoOutlined />}>
                      回滚
                    </Button>
                  </Popconfirm>
                ),
                s.isActive && (
                  <Popconfirm
                    key="deactivate"
                    title="停用后 SkillRouter 不会路由到它"
                    onConfirm={() => handleDeactivate(s.name)}
                  >
                    <Button type="link" icon={<PoweroffOutlined />}>
                      停用
                    </Button>
                  </Popconfirm>
                ),
                <Popconfirm
                  key="delete"
                  title="永久删除？不可恢复"
                  okType="danger"
                  onConfirm={() => handleHardDelete(s.name)}
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>,
              ].filter(Boolean) as React.ReactNode[]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Text strong>{s.name}</Text>
                    <Tag color="purple">v{s.version}</Tag>
                    {s.priority > 0 && <Tag color="orange">优先级 {s.priority}</Tag>}
                    {!s.isActive && <Tag color="default">已停用</Tag>}
                    {s.source === 'seed' && <Tag color="cyan">初始 seed</Tag>}
                    {s.visibility && s.visibility !== 'global' && (
                      <Tag color={VISIBILITY_META[s.visibility].color}>
                        {VISIBILITY_META[s.visibility].label}
                      </Tag>
                    )}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text>{s.description}</Text>
                    {s.match && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <ThunderboltOutlined /> 触发词：
                        </Text>
                        <Space size={4} wrap>
                          {s.match.split('|').map((k) => k.trim()).filter(Boolean).map((k) => (
                            <Tag key={k} color="blue">
                              {k}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {s.tables && s.tables.length > 0 && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <DatabaseOutlined /> 表白名单：
                        </Text>
                        {s.tables.map((t) => (
                          <Tag key={t} color="geekblue">
                            {t}
                          </Tag>
                        ))}
                      </div>
                    )}
                    {s.attributableDimensions && s.attributableDimensions.length > 0 && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <AimOutlined /> 归因维度：
                        </Text>
                        {s.attributableDimensions.map((d) => (
                          <Tag key={d} color="green">
                            {d}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Drawer
        title={editing ? `编辑 Skill: ${editing.name}` : '新建 Skill'}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        width={760}
        destroyOnClose
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSave}>
              保存并热重载
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" disabled={editorLoading}>
          <Form.Item
            name="name"
            label="名称 (kebab-case, 唯一)"
            rules={[
              { required: true },
              {
                pattern: /^[a-z0-9][\w-]*$/,
                message: '只允许字母数字-_，必须字母数字开头',
              },
            ]}
          >
            <Input placeholder="如 dispatcher-efficiency" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="version" label="版本号">
            <Input placeholder="1.0.0" />
          </Form.Item>
          <Form.Item name="description" label="一句话描述" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="什么场景下用这个 Skill" />
          </Form.Item>
          <Form.Item name="match" label="触发关键词（用 | 分隔）">
            <Input placeholder="派件员 | dispatcher | 人效" />
          </Form.Item>
          <Form.Item name="priority" label="优先级" tooltip="数字大优先">
            <InputNumber min={0} max={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="tables" label="表白名单 (含 schema)" tooltip="留空 = 不限制">
            <Select mode="tags" placeholder="dwd.dispatcher_efficiency_detail" />
          </Form.Item>
          <Form.Item name="attributableDimensions" label="归因维度">
            <Select mode="tags" placeholder="按这些字段拆解归因，如 station_name" />
          </Form.Item>
          <Form.Item name="datasourceTypes" label="适用数据源类型">
            <Select mode="tags" placeholder="postgresql, mysql" />
          </Form.Item>
          <Form.Item
            name="body"
            label="Markdown 正文（业务说明、字段语义、术语词典、行业基准、陷阱等）"
            extra={
              <span>
                推荐章节：<Text code>## 适用范围</Text> / <Text code>## 核心数据源</Text> /{' '}
                <Text code>## 字段语义</Text> / <Text code>## 业务术语词典</Text> /{' '}
                <Text code>## 行业基准</Text>（用户问"行业水平"时引用）/{' '}
                <Text code>## 关联指标</Text> / <Text code>## 拒答边界</Text>
              </span>
            }
            rules={[{ required: true, min: 20 }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 18, maxRows: 40 }}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
              placeholder={`# 业务领域名称

## 适用范围
...

## 核心数据源
| 表 | 说明 | 行数 |
|---|---|---|
| dwd.xxx_detail | ... | ... |

## 字段语义
| 字段 | 含义 | 陷阱 |
|---|---|---|

## 业务术语词典
单量 = count(distinct waybill_no)

## 行业基准
> 数据来源：手动维护的行业基准库（用户问"行业水平"时通过 cite_industry_benchmark 工具引用）

### 派件签收率
- 行业平均：88% – 92%
- 头部物流：93% – 96%
`}
            />
          </Form.Item>
          <Form.Item name="isActive" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="可见范围"
            tooltip="决定哪些用户能在 Chat 路由到这个 Skill"
            rules={[{ required: true }]}
          >
            <Select
              onChange={(v: 'global' | 'project' | 'personal') => {
                setFormVisibility(v);
                if (v !== 'project') form.setFieldsValue({ projectId: null });
              }}
              options={[
                { value: 'global', label: '🌐 全局（所有用户可见）' },
                { value: 'project', label: '👥 项目（仅项目成员可见）' },
                { value: 'personal', label: '🔒 个人（仅自己可见）' },
              ]}
            />
          </Form.Item>
          {formVisibility === 'project' && (
            <Form.Item
              name="projectId"
              label="所属项目"
              rules={[{ required: true, message: '请选择项目' }]}
            >
              <Select
                placeholder="选择项目"
                options={projects.map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.isPersonalWorkspace ? ' (个人工作区)' : ''}`,
                }))}
              />
            </Form.Item>
          )}
          {editing && (
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              当前数据库版本：{editing.rowVersion}（保存时若与服务端不一致会报冲突）；
              最近修改：{new Date(editing.updatedAt).toLocaleString()}
              {editing.hasRollback ? '；有可回滚的上一版' : ''}
            </Paragraph>
          )}
        </Form>
      </Drawer>
    </div>
  );
}
