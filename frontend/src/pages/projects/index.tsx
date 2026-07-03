import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CrownOutlined,
  EditOutlined,
  PlusOutlined,
  ProjectOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { projectService, Project } from '@/services';

const { Title, Text, Paragraph } = Typography;

const roleColors: Record<string, string> = {
  owner: 'gold',
  admin: 'volcano',
  editor: 'blue',
  viewer: 'default',
};

export default function ProjectsPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [list, setList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      setList(await projectService.list());
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const p = await projectService.create(form.getFieldsValue());
      message.success('已创建');
      setOpen(false);
      form.resetFields();
      void router.push(`/projects/${p.id}`);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <ProjectOutlined />
            <Title level={4} style={{ margin: 0 }}>
              我的项目
            </Title>
            <Tag>{list.length}</Tag>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新建项目
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          一个项目 = 一组共享上下文的对话 + 团队协作成员。项目级"系统指令"会自动注入到每次 Agent 推理。
        </Paragraph>

        {!loading && list.length === 0 && (
          <Empty description="还没有项目，新建一个开始吧" />
        )}

        <Row gutter={[16, 16]}>
          {list.map((p) => (
            <Col key={p.id} xs={24} sm={12} md={8} xl={6}>
              <Card
                hoverable
                onClick={() => router.push(`/projects/${p.id}`)}
                styles={{ body: { padding: 16 } }}
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space>
                    <Avatar
                      style={{ background: '#1677ff' }}
                      icon={!p.icon && <ProjectOutlined />}
                    >
                      {p.icon}
                    </Avatar>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <Tag color={roleColors[p.myRole]} style={{ fontSize: 11 }}>
                        {p.myRole === 'owner' && <CrownOutlined />} {p.myRole}
                      </Tag>
                    </div>
                  </Space>
                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ fontSize: 12, marginBottom: 0, minHeight: 36 }}
                  >
                    {p.description || '—'}
                  </Paragraph>
                  <Space size={12} style={{ fontSize: 12, color: '#8f959e' }}>
                    <span>
                      <TeamOutlined /> {p.memberCount || 1} 成员
                    </span>
                    {p.systemInstructions && (
                      <Badge color="cyan" text={<span>含项目指令</span>} />
                    )}
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Drawer
        title="新建项目"
        open={open}
        onClose={() => setOpen(false)}
        width={520}
        destroyOnClose
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" onClick={onCreate} loading={saving}>
              创建
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名" rules={[{ required: true, max: 255 }]}>
            <Input placeholder="如：2026 Q3 销售复盘" />
          </Form.Item>
          <Form.Item name="icon" label="图标（emoji 或留空）">
            <Input placeholder="📊" maxLength={4} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="一句话描述项目目标" />
          </Form.Item>
          <Form.Item
            name="systemInstructions"
            label="项目级系统指令（可选）"
            extra="这段文字会作为每次 Agent 推理的前置上下文。可以放业务背景、口径偏好、回答风格等。"
          >
            <Input.TextArea
              rows={6}
              placeholder={`例：你正在协助 2026 Q3 销售团队复盘。
- 所有单量按"成单订单"口径
- 时间默认 7-9 月
- 简洁回答，避免重复列字段定义`}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
