import React, { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Space, Table, Tag, Typography } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import dayjs from 'dayjs';
import { Datasource } from '@/types';
import { datasourceService } from '@/services';
import { DatasourceFormDrawer } from '@/components/datasource/DatasourceFormDrawer';

const { Title, Text } = Typography;

export default function DatasourcePage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Datasource[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Datasource | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await datasourceService.list();
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

  const handleDelete = (item: Datasource) => {
    modal.confirm({
      title: '删除数据源',
      content: `确定要删除「${item.name}」吗？相关对话和任务将无法继续访问该数据源。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await datasourceService.remove(item.id);
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
            数据源管理
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
              新建数据源
            </Button>
          </Space>
        </Space>

        <Table<Datasource>
          loading={loading}
          dataSource={data}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              key: 'name',
              render: (v, row) => (
                <div>
                  <Text strong>{v}</Text>
                  {row.description && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {row.description}
                      </Text>
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: '类型',
              dataIndex: 'type',
              key: 'type',
              render: (v) => <Tag color="blue">{v}</Tag>,
            },
            {
              title: '连接信息',
              key: 'connection',
              render: (_, row) => (
                <Text code style={{ fontSize: 12 }}>
                  {row.config?.host}:{row.config?.port}/{row.config?.database}
                </Text>
              ),
            },
            {
              title: '关联数据集',
              dataIndex: 'datasetNames',
              key: 'datasetNames',
              render: (v: string[]) =>
                (v || []).map((d) => (
                  <Tag key={d} color="geekblue">
                    {d}
                  </Tag>
                )),
            },
            {
              title: '状态',
              dataIndex: 'isActive',
              key: 'isActive',
              render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, row) => (
                <Space>
                  <Button
                    type="link"
                    icon={<SettingOutlined />}
                    onClick={() => router.push(`/datasource/${row.id}`)}
                  >
                    详情/元数据
                  </Button>
                  <Button
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditing(row);
                      setDrawerOpen(true);
                    }}
                  >
                    编辑连接
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

      <DatasourceFormDrawer
        open={drawerOpen}
        initial={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
