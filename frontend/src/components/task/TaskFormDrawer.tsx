import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Drawer, Form, Input, Select, Space, Switch } from 'antd';
import { CreateTaskPayload, Datasource, Task } from '@/types';
import { datasourceService, taskService } from '@/services';

interface Props {
  open: boolean;
  initial?: Task | null;
  onClose: () => void;
  onSaved: () => void;
}

const cronPresets = [
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每小时整点', value: '0 * * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每月 1 号 09:00', value: '0 9 1 * *' },
];

export const TaskFormDrawer: React.FC<Props> = ({ open, initial, onClose, onSaved }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [datasources, setDatasources] = useState<Datasource[]>([]);

  useEffect(() => {
    if (open) {
      void datasourceService.list().then((res) => setDatasources(res.data));
      form.resetFields();
      if (initial) {
        form.setFieldsValue(initial);
      } else {
        form.setFieldsValue({ isActive: true });
      }
    }
  }, [open, initial, form]);

  const handleSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue() as CreateTaskPayload;
    setSaving(true);
    try {
      if (initial) {
        await taskService.update(initial.id, values);
        message.success('已更新');
      } else {
        await taskService.create(values);
        message.success('已创建');
      }
      onSaved();
      onClose();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={initial ? '编辑任务' : '新建定时任务'}
      open={open}
      onClose={onClose}
      width={520}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleSubmit} loading={saving}>
            保存
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        message="任务到点自动触发 SQL 生成 + 执行，可选地将结果推送到飞书机器人。"
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
          <Input placeholder="例如：新产品每小时单量监控" />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="question"
          label="自然语言问题"
          rules={[{ required: true }]}
          tooltip="任务执行时，会以此问题驱动 SQL Agent 生成查询"
        >
          <Input.TextArea
            rows={3}
            placeholder="例如：新产品昨天每小时的订单数，与近 7 日均值对比"
          />
        </Form.Item>
        <Form.Item
          name="datasourceId"
          label="数据源"
          rules={[{ required: true }]}
        >
          <Select
            placeholder="选择数据源"
            options={datasources.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Form.Item>
        <Form.Item
          name="cronExpression"
          label="Cron 表达式"
          rules={[{ required: true }]}
        >
          <Input
            placeholder="0 9 * * *"
            addonAfter={
              <Select
                style={{ width: 140 }}
                placeholder="预设"
                onChange={(v) => form.setFieldValue('cronExpression', v)}
                options={cronPresets}
              />
            }
          />
        </Form.Item>
        <Form.Item
          name="feishuWebhook"
          label="飞书 Webhook（可选）"
          tooltip="留空则不推送到飞书"
        >
          <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" />
        </Form.Item>
        <Form.Item name="isActive" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
};
