import React from 'react';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { DatabaseOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { LineageBadge } from '@/types';

const { Text } = Typography;

interface Props {
  lineage?: LineageBadge[];
}

/**
 * 数据血缘 badge
 * - 自动从 SQL 涉及的表抽取统计信息
 * - 用户能一眼看出"这答案来自哪张表 / 多少行 / 最近啥时候有数据"
 * - 数据明显陈旧时（>24h）会被 orchestrator 转成 warning insight 在上面展示
 */
export const LineageBadges: React.FC<Props> = ({ lineage }) => {
  if (!lineage || lineage.length === 0) return null;

  return (
    <Space size={6} wrap style={{ marginTop: 6 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        <DatabaseOutlined /> 数据来源：
      </Text>
      {lineage.map((b, i) => {
        const stale = b.lastActivityAt
          ? Date.now() - new Date(b.lastActivityAt).getTime() > 24 * 3600 * 1000
          : false;
        const parts: string[] = [`${b.schema}.${b.table}`];
        if (b.estimatedRowCount != null) {
          parts.push(`约 ${formatRowCount(b.estimatedRowCount)} 行`);
        }
        if (b.sizeBytes != null) {
          parts.push(`${formatSize(b.sizeBytes)}`);
        }
        if (b.lastActivityHuman) {
          parts.push(`活动 ${b.lastActivityHuman}`);
        }
        return (
          <Tooltip
            key={i}
            title={
              <div style={{ fontSize: 12 }}>
                <div><strong>表</strong>：{b.schema}.{b.table}</div>
                {b.estimatedRowCount != null && (
                  <div>
                    <strong>估算行数</strong>：{b.estimatedRowCount.toLocaleString()}
                  </div>
                )}
                {b.sizeBytes != null && (
                  <div>
                    <strong>占用</strong>：{formatSize(b.sizeBytes)}
                  </div>
                )}
                {b.lastActivityAt && (
                  <div>
                    <ClockCircleOutlined />{' '}
                    <strong>最近写入</strong>：{new Date(b.lastActivityAt).toLocaleString()}
                  </div>
                )}
                {b.lastAnalyzedAt && (
                  <div>
                    <strong>最近 ANALYZE</strong>：{new Date(b.lastAnalyzedAt).toLocaleString()}
                  </div>
                )}
              </div>
            }
          >
            <Tag
              icon={<DatabaseOutlined />}
              color={stale ? 'orange' : 'default'}
              style={{ cursor: 'help' }}
            >
              {parts.join(' · ')}
            </Tag>
          </Tooltip>
        );
      })}
    </Space>
  );
};

function formatRowCount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
  return n.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
