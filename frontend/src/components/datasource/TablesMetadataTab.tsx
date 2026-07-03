import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { datasourceService, metadataService } from '@/services';
import type { TableMetadata } from '@/types';

const { Title, Text } = Typography;

interface Props {
  datasourceId: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

const COMMON_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Jakarta',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'America/Los_Angeles',
  'Europe/London',
];

/**
 * 表与字段元数据编辑器
 * - 列出数据源的所有表
 * - 展开每张表 → 表级 + 列级元数据编辑
 */
export const TablesMetadataTab: React.FC<Props> = ({ datasourceId }) => {
  const { message } = App.useApp();
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadTables();
  }, [datasourceId]);

  const loadTables = async () => {
    setLoading(true);
    try {
      const list = await datasourceService.listTables(datasourceId);
      setTables(list);
    } catch (err) {
      message.error(`加载表列表失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            数据源的表
          </Title>
          <Text type="secondary" style={{ fontWeight: 'normal' }}>
            共 {tables.length} 张
          </Text>
        </Space>
      }
      extra={<Button icon={<ReloadOutlined />} onClick={loadTables}>刷新</Button>}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Collapse
          accordion
          items={tables.map((tableName) => ({
            key: tableName,
            label: <Text code>{tableName}</Text>,
            children: <TableMetaEditor datasourceId={datasourceId} tableName={tableName} />,
          }))}
        />
      )}
    </Card>
  );
};

interface EditorProps {
  datasourceId: string;
  tableName: string;
}

const TableMetaEditor: React.FC<EditorProps> = ({ datasourceId, tableName }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [physColumns, setPhysColumns] = useState<ColumnInfo[]>([]);
  const [tableMeta, setTableMeta] = useState<Partial<TableMetadata>>({});
  const [columnMetaMap, setColumnMetaMap] = useState<
    Record<string, Partial<TableMetadata>>
  >({});

  useEffect(() => {
    void load();
  }, [datasourceId, tableName]);

  const load = async () => {
    setLoading(true);
    try {
      // 并发拉物理列结构 + 已存的元数据
      const [physical, meta] = await Promise.all([
        datasourceService.describeTable(datasourceId, tableName),
        metadataService.getTable(datasourceId, tableName),
      ]);
      setPhysColumns(physical.columns);
      setTableMeta(meta.table || {});
      const map: Record<string, Partial<TableMetadata>> = {};
      for (const c of meta.columns) {
        if (c.columnName) map[c.columnName] = c;
      }
      setColumnMetaMap(map);
    } catch (err) {
      message.error(`加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const updateColumn = (colName: string, patch: Partial<TableMetadata>) => {
    setColumnMetaMap((prev) => ({
      ...prev,
      [colName]: { ...prev[colName], columnName: colName, ...patch },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 表级
      await metadataService.upsertTable(datasourceId, tableName, {
        businessName: tableMeta.businessName,
        description: tableMeta.description,
        timezone: tableMeta.timezone,
        synonyms: tableMeta.synonyms,
      });
      // 批量列级
      const columns = Object.values(columnMetaMap)
        .filter((c) => c.columnName)
        .map((c) => ({
          columnName: c.columnName!,
          businessName: c.businessName,
          description: c.description,
          unit: c.unit,
          synonyms: c.synonyms,
        }));
      if (columns.length > 0) {
        await metadataService.batchUpsertColumns(datasourceId, tableName, columns);
      }
      message.success('保存成功');
      await load();
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spin />
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 表级元数据 */}
      <Card size="small" title="表级元数据">
        <Form layout="vertical" size="small">
          <Form.Item label="业务名">
            <Input
              value={tableMeta.businessName || ''}
              onChange={(e) =>
                setTableMeta({ ...tableMeta, businessName: e.target.value })
              }
              placeholder="例：派件员人效明细"
            />
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              rows={2}
              value={tableMeta.description || ''}
              onChange={(e) =>
                setTableMeta({ ...tableMeta, description: e.target.value })
              }
              placeholder="给 LLM 看的业务说明。讲讲粒度、来源、注意事项"
            />
          </Form.Item>
          <Form.Item label="时区">
            <Select
              value={tableMeta.timezone || undefined}
              onChange={(v) => setTableMeta({ ...tableMeta, timezone: v })}
              options={COMMON_TIMEZONES.map((t) => ({ label: t, value: t }))}
              allowClear
              placeholder="不填则使用 UTC"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="同义词">
            <Select
              mode="tags"
              value={tableMeta.synonyms || []}
              onChange={(v) => setTableMeta({ ...tableMeta, synonyms: v })}
              placeholder="用户可能用的别名，回车添加"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* 列级元数据 */}
      <Card size="small" title={`字段元数据（${physColumns.length} 列）`}>
        <Table
          size="small"
          pagination={false}
          rowKey="name"
          dataSource={physColumns}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '字段名',
              dataIndex: 'name',
              key: 'name',
              fixed: 'left',
              render: (v: string, row) => (
                <Space direction="vertical" size={0}>
                  <Text code>{v}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {row.type}
                  </Text>
                </Space>
              ),
            },
            {
              title: '业务名',
              key: 'businessName',
              width: 140,
              render: (_, row) => (
                <Input
                  size="small"
                  value={columnMetaMap[row.name]?.businessName || ''}
                  onChange={(e) =>
                    updateColumn(row.name, { businessName: e.target.value })
                  }
                  placeholder="-"
                />
              ),
            },
            {
              title: '描述 / 陷阱',
              key: 'description',
              render: (_, row) => (
                <Input.TextArea
                  size="small"
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  value={columnMetaMap[row.name]?.description || ''}
                  onChange={(e) =>
                    updateColumn(row.name, { description: e.target.value })
                  }
                  placeholder="例：枚举 Ya=准时 / Tidak=超时；单量需 distinct"
                />
              ),
            },
            {
              title: '单位',
              key: 'unit',
              width: 80,
              render: (_, row) => (
                <Input
                  size="small"
                  value={columnMetaMap[row.name]?.unit || ''}
                  onChange={(e) => updateColumn(row.name, { unit: e.target.value })}
                  placeholder="件/kg..."
                />
              ),
            },
            {
              title: '同义词',
              key: 'synonyms',
              width: 200,
              render: (_, row) => (
                <Select
                  mode="tags"
                  size="small"
                  style={{ width: '100%' }}
                  value={columnMetaMap[row.name]?.synonyms || []}
                  onChange={(v) => updateColumn(row.name, { synonyms: v })}
                  placeholder="别名"
                />
              ),
            },
          ]}
        />
      </Card>

      <div style={{ textAlign: 'right' }}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          保存全部
        </Button>
      </div>
    </Space>
  );
};
