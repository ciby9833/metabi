import React, { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Space, Table, Tag, Typography } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Task } from '@/types';
import { taskService } from '@/services';
import { TaskFormDrawer } from '@/components/task/TaskFormDrawer';

const { Title, Text } = Typography;

const statusColor: Record<string, string> = {
  success: 'green',
  failed: 'red',
  running: 'blue',
  pending: 'orange',
  disabled: 'default',
};

export default function TaskPage() {
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Task[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await taskService.list();
      setData(res.data);
    } catch (err) {
      message.error(`加载失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExecute = async (task: Task) => {
    setExecutingId(task.id);
    try {
      await taskService.execute(task.id);
      message.success(`任务「${task.name}」执行成功`);
      await load();
    } catch (err) {
      message.error(`执行失败：${(err as Error).message}`);
    } finally {
      setExecutingId(null);
    }
  };

  const handleDelete = (task: Task) => {
    modal.confirm({
      title: '删除任务',
      content: `确定要删除「${task.name}」吗？`,
      okType: 'danger',
      onOk: async () => {
        try {
          await taskService.remove(task.id);
          message.success('已删除');
          await load();
        } catch (err) {
          message.error(`删除失败：${(err as Error).message}`);
        }
      },
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <Space style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Title level={4} style={{ margin: 0 }}>
            定时任务
          </Title>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              新建任务
            </Button>
          </Space>
        </Space>

        <Table<Task>
          loading={loading}
          dataSource={data}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '任务',
              dataIndex: 'name',
              key: 'name',
              render: (v, row) => (
                <div>
                  <Text strong>{v}</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {row.question}
                    </Text>
                  </div>
                </div>
              ),
            },
            {
              title: 'Cron',
              dataIndex: 'cronExpression',
              key: 'cron',
              render: (v) => <Text code>{v || '-'}</Text>,
            },
            {
              title: '飞书推送',
              dataIndex: 'feishuWebhook',
              key: 'feishu',
              render: (v) => (v ? <Tag color="cyan">已配置</Tag> : <Tag>未配置</Tag>),
            },
            {
              title: '上次运行',
              dataIndex: 'lastRunAt',
              key: 'lastRunAt',
              render: (v, row) => (
                <Space direction="vertical" size={0}>
                  {v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'}
                  {row.lastStatus && (
                    <Tag color={statusColor[row.lastStatus] || 'default'}>
                      {row.lastStatus}
                    </Tag>
                  )}
                </Space>
              ),
            },
            {
              title: '状态',
              dataIndex: 'isActive',
              key: 'isActive',
              render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, row) => (
                <Space>
                  <Button
                    type="link"
                    icon={<PlayCircleOutlined />}
                    loading={executingId === row.id}
                    onClick={() => handleExecute(row)}
                  >
                    立即执行
                  </Button>
                  <Button
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditing(row);
                      setDrawerOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDelete(row)}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <TaskFormDrawer
        open={drawerOpen}
        initial={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
