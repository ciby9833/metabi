import React from 'react';
import { Collapse, Tag, Typography } from 'antd';
import { CheckCircleTwoTone, DatabaseOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface SqlPanelProps {
  sql?: string;
  reasoning?: string;
  datasetsUsed?: string[];
  confidence?: number;
  executionTimeMs?: number;
  fromCache?: boolean;
  rowCount?: number;
}

export const SqlPanel: React.FC<SqlPanelProps> = ({
  sql,
  reasoning,
  datasetsUsed,
  confidence,
  executionTimeMs,
  fromCache,
  rowCount,
}) => {
  if (!sql) return null;

  return (
    <Collapse
      size="small"
      ghost
      items={[
        {
          key: 'sql',
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DatabaseOutlined />
              <Text strong>SQL 与执行详情</Text>
              {fromCache && <Tag color="cyan">缓存</Tag>}
              {typeof rowCount === 'number' && (
                <Tag>共 {rowCount.toLocaleString()} 行</Tag>
              )}
              {typeof executionTimeMs === 'number' && (
                <Tag>耗时 {executionTimeMs}ms</Tag>
              )}
              {typeof confidence === 'number' && (
                <Tag color={confidence >= 0.8 ? 'green' : 'orange'}>
                  <CheckCircleTwoTone twoToneColor="#52c41a" /> 置信度{' '}
                  {(confidence * 100).toFixed(0)}%
                </Tag>
              )}
            </div>
          ),
          children: (
            <>
              {reasoning && (
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  <strong>思路：</strong>
                  {reasoning}
                </Paragraph>
              )}
              {datasetsUsed && datasetsUsed.length > 0 && (
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  <strong>使用数据集：</strong>
                  {datasetsUsed.map((d) => (
                    <Tag key={d} color="blue">
                      {d}
                    </Tag>
                  ))}
                </Paragraph>
              )}
              <pre
                style={{
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: 12,
                  borderRadius: 6,
                  overflow: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {sql}
              </pre>
            </>
          ),
        },
      ]}
    />
  );
};
