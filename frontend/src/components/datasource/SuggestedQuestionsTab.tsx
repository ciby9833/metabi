import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { metadataService } from '@/services';
import type { SuggestedQuestion } from '@/types';

const { Text } = Typography;

interface Props {
  datasourceId: string;
}

export const SuggestedQuestionsTab: React.FC<Props> = ({ datasourceId }) => {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<SuggestedQuestion[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, [datasourceId]);

  const load = async () => {
    setLoading(true);
    try {
      const list = await metadataService.listQuestions(datasourceId);
      setItems(list);
    } catch (err) {
      message.error(`加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue();
    try {
      await metadataService.createQuestion(datasourceId, values);
      message.success('已添加');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (err) {
      message.error(`添加失败: ${(err as Error).message}`);
    }
  };

  return (
    <Card
      size="small"
      title="推荐问题"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            setOpen(true);
          }}
        >
          新增
        </Button>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        在聊天页面会作为可点击的提示展示，引导业务用户从已验证的问题开始
      </Text>
      <List
        loading={loading}
        dataSource={items}
        locale={{ emptyText: '暂无推荐问题' }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button
                key="del"
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  modal.confirm({
                    title: '删除推荐问题？',
                    content: item.questionText,
                    onOk: async () => {
                      await metadataService.deleteQuestion(datasourceId, item.id);
                      message.success('已删除');
                      await load();
                    },
                  })
                }
              />,
            ]}
          >
            <Space direction="vertical" size={2}>
              <Text>{item.questionText}</Text>
              <Space size={4}>
                <Tag color={item.source === 'learned' ? 'cyan' : 'default'}>
                  {item.source === 'learned' ? '历史沉淀' : '手动'}
                </Tag>
                {item.priority > 0 && <Tag color="orange">优先级 {item.priority}</Tag>}
                {item.learnedSql && (
                  <Tag color="blue" title={item.learnedSql}>
                    含 SQL 示例
                  </Tag>
                )}
              </Space>
            </Space>
          </List.Item>
        )}
      />

      <Modal title="新增推荐问题" open={open} onCancel={() => setOpen(false)} onOk={handleAdd}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="questionText"
            label="问题文本"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} placeholder="例：各站点昨天的派件量 Top 10" />
          </Form.Item>
          <Form.Item name="priority" label="排序优先级" initialValue={0}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};
