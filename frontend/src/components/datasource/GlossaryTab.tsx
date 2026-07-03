import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { datasourceService, metadataService } from '@/services';
import type { GlossaryItem } from '@/types';

const { Text } = Typography;

interface Props {
  datasourceId: string;
}

/**
 * 业务术语词典编辑：跨表的概念定义（人效、单量、准时率 ...）
 */
export const GlossaryTab: React.FC<Props> = ({ datasourceId }) => {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<GlossaryItem[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<GlossaryItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    void load();
    void datasourceService.listTables(datasourceId).then(setTables).catch(() => undefined);
  }, [datasourceId]);

  const load = async () => {
    setLoading(true);
    try {
      const list = await metadataService.listGlossary(datasourceId);
      setItems(list);
    } catch (err) {
      message.error(`加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue();
    try {
      if (editing) {
        await metadataService.updateGlossary(datasourceId, editing.id, values);
        message.success('已更新');
      } else {
        await metadataService.createGlossary(datasourceId, values);
        message.success('已添加');
      }
      setOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`);
    }
  };

  return (
    <Card
      size="small"
      title="业务术语词典"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            form.resetFields();
            setOpen(true);
          }}
        >
          新增术语
        </Button>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        把业务口语和 SQL 语义对应起来。例：人效 = sum(piece_count) / count(distinct dispatcher_id)
      </Text>
      <Table<GlossaryItem>
        size="small"
        loading={loading}
        dataSource={items}
        rowKey="id"
        pagination={{ pageSize: 10 }}
        columns={[
          {
            title: '术语',
            dataIndex: 'term',
            key: 'term',
            width: 140,
            render: (v) => <Text strong>{v}</Text>,
          },
          {
            title: '含义',
            dataIndex: 'meaning',
            key: 'meaning',
            render: (v) => <Text style={{ whiteSpace: 'pre-wrap' }}>{v}</Text>,
          },
          {
            title: 'SQL 示例',
            dataIndex: 'exampleSql',
            key: 'exampleSql',
            render: (v) => (v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '-'),
          },
          {
            title: '适用表',
            dataIndex: 'appliesToTables',
            key: 'appliesToTables',
            render: (v: string[]) => (v?.length ? v.join(', ') : '全部'),
          },
          {
            title: '操作',
            key: 'actions',
            width: 120,
            render: (_, row) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(row);
                    form.setFieldsValue({
                      term: row.term,
                      meaning: row.meaning,
                      exampleSql: row.exampleSql,
                      appliesToTables: row.appliesToTables,
                    });
                    setOpen(true);
                  }}
                />
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    modal.confirm({
                      title: `删除「${row.term}」？`,
                      onOk: async () => {
                        await metadataService.deleteGlossary(datasourceId, row.id);
                        message.success('已删除');
                        await load();
                      },
                    })
                  }
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑术语' : '新增术语'}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="term" label="术语" rules={[{ required: true }]}>
            <Input placeholder="例：人效" />
          </Form.Item>
          <Form.Item name="meaning" label="含义" rules={[{ required: true }]}>
            <Input.TextArea
              rows={3}
              placeholder="给 LLM 看的解释，可以是文字也可以是 SQL 表达式"
            />
          </Form.Item>
          <Form.Item name="exampleSql" label="SQL 示例（可选）">
            <Input.TextArea
              rows={3}
              placeholder="sum(piece_count) / nullif(count(distinct dispatcher_id), 0)"
            />
          </Form.Item>
          <Form.Item
            name="appliesToTables"
            label="适用表（不选 = 全部）"
            tooltip="术语只在这些表对应的问题中注入"
          >
            <Select
              mode="multiple"
              placeholder="选择适用的表"
              options={tables.map((t) => ({ label: t, value: t }))}
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};
