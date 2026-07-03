import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { App, Breadcrumb, Card, Skeleton, Space, Tabs, Tag, Typography } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { datasourceService } from '@/services';
import type { Datasource } from '@/types';
import { TablesMetadataTab } from '@/components/datasource/TablesMetadataTab';
import { GlossaryTab } from '@/components/datasource/GlossaryTab';
import { SuggestedQuestionsTab } from '@/components/datasource/SuggestedQuestionsTab';

const { Title, Text } = Typography;

export default function DatasourceDetailPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { id } = router.query;
  const datasourceId = typeof id === 'string' ? id : '';
  const [datasource, setDatasource] = useState<Datasource | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!datasourceId) return;
    void load();
  }, [datasourceId]);

  const load = async () => {
    setLoading(true);
    try {
      setDatasource(await datasourceService.getById(datasourceId));
    } catch (err) {
      message.error(`加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !datasource) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => router.push('/datasource')}>数据源</a> },
          { title: datasource.name },
        ]}
      />
      <Card style={{ marginBottom: 16 }}>
        <Space size={16} align="center">
          <DatabaseOutlined style={{ fontSize: 24 }} />
          <Space direction="vertical" size={0}>
            <Title level={4} style={{ margin: 0 }}>
              {datasource.name}
            </Title>
            <Space>
              <Tag color="blue">{datasource.type}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {datasource.config?.host}:{datasource.config?.port}/
                {datasource.config?.database}
              </Text>
            </Space>
          </Space>
        </Space>
      </Card>

      <Tabs
        defaultActiveKey="tables"
        items={[
          {
            key: 'tables',
            label: '📋 表与字段',
            children: <TablesMetadataTab datasourceId={datasourceId} />,
          },
          {
            key: 'glossary',
            label: '📖 业务词典',
            children: <GlossaryTab datasourceId={datasourceId} />,
          },
          {
            key: 'questions',
            label: '💡 推荐问题',
            children: <SuggestedQuestionsTab datasourceId={datasourceId} />,
          },
        ]}
      />
    </div>
  );
}
