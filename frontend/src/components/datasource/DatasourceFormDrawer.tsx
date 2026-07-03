import React, { useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  App,
} from 'antd';
import {
  CreateDatasourcePayload,
  Datasource,
  DatasourceType,
} from '@/types';
import { datasourceService } from '@/services';

interface Props {
  open: boolean;
  initial?: Datasource | null;
  onClose: () => void;
  onSaved: () => void;
}

const typeOptions: { value: DatasourceType; label: string }[] = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
];

export const DatasourceFormDrawer: React.FC<Props> = ({
  open,
  initial,
  onClose,
  onSaved,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  React.useEffect(() => {
    if (open) {
      form.resetFields();
      if (initial) {
        form.setFieldsValue({
          name: initial.name,
          type: initial.type,
          description: initial.description,
          host: initial.config?.host,
          port: initial.config?.port,
          database: initial.config?.database,
          username: initial.config?.username,
          password: initial.config?.password,
          schema: initial.config?.schema,
          ssl: initial.config?.ssl,
          datasetNames: initial.datasetNames,
        });
      } else {
        form.setFieldsValue({
          type: 'postgresql',
          port: 5432,
          ssl: false,
        });
      }
    }
  }, [open, initial, form]);

  const buildPayload = (): CreateDatasourcePayload => {
    const values = form.getFieldsValue();
    return {
      name: values.name,
      type: values.type,
      description: values.description,
      config: {
        host: values.host,
        port: values.port,
        database: values.database,
        username: values.username,
        password: values.password,
        schema: values.schema,
        ssl: values.ssl,
      },
      datasetNames: values.datasetNames || [],
    };
  };

  const handleTest = async () => {
    try {
      await form.validateFields([
        'type',
        'host',
        'port',
        'database',
        'username',
        'password',
      ]);
    } catch {
      return;
    }
    setTesting(true);
    try {
      const payload = buildPayload();
      const res = await datasourceService.testConnection({
        type: payload.type,
        config: payload.config,
      });
      if (res.success) {
        message.success(
          `连接成功！耗时 ${res.latencyMs}ms${res.serverVersion ? `，服务器：${res.serverVersion}` : ''}`,
        );
      } else {
        message.error(`连接失败：${res.message}`);
      }
    } catch (err) {
      message.error(`测试失败：${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (initial) {
        // update 不允许改类型（后端 DTO 不接受）；type 留在 buildPayload 里只是 testConnection 用
        const { type: _ignored, ...updatable } = payload;
        await datasourceService.update(initial.id, updatable);
        message.success('已更新');
      } else {
        await datasourceService.create(payload);
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
      title={initial ? '编辑数据源' : '新建数据源'}
      open={open}
      onClose={onClose}
      width={520}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button onClick={handleTest} loading={testing}>
            测试连接
          </Button>
          <Button type="primary" onClick={handleSubmit} loading={saving}>
            保存
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        message="所有连接信息存储在后端数据库中。生产环境请使用只读账号。"
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input placeholder="例如：订单库（只读）" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="可选" />
        </Form.Item>
        <Form.Item
          name="type"
          label="类型"
          rules={[{ required: true }]}
        >
          <Select options={typeOptions} />
        </Form.Item>
        <Space.Compact block>
          <Form.Item
            name="host"
            label="Host"
            style={{ flex: 2 }}
            rules={[{ required: true }]}
          >
            <Input placeholder="localhost" />
          </Form.Item>
          <Form.Item
            name="port"
            label="Port"
            style={{ flex: 1, marginLeft: 8 }}
            rules={[{ required: true }]}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Space.Compact>
        <Form.Item
          name="database"
          label="Database"
          rules={[{ required: true }]}
        >
          <Input placeholder="chatbi_db" />
        </Form.Item>
        <Form.Item name="schema" label="Schema (可选)">
          <Input placeholder="public" />
        </Form.Item>
        <Form.Item
          name="username"
          label="Username"
          rules={[{ required: true }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Password"
          rules={[{ required: true }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="ssl" label="SSL" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="datasetNames"
          label="关联的语义层数据集"
          tooltip="对应 backend/src/providers/semantic/definitions/schemas.yaml 中的 dataset name"
        >
          <Select
            mode="tags"
            placeholder="例如：dwd_waybill, dwd_order_hourly"
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
};
