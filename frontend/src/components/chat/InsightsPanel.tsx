import React from 'react';
import { Alert, Space, Tag, Typography } from 'antd';
import {
  BulbOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  ThunderboltOutlined,
  FireOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { Insight, InsightKind, InsightSeverity } from '@/types';

const { Text } = Typography;

interface Props {
  insights?: Insight[];
}

const severityMap: Record<InsightSeverity, { type: 'info' | 'warning' | 'error'; icon: React.ReactNode }> = {
  info: { type: 'info', icon: <BulbOutlined /> },
  warning: { type: 'warning', icon: <WarningOutlined /> },
  critical: { type: 'error', icon: <ExclamationCircleOutlined /> },
};

const kindLabel: Record<InsightKind, string> = {
  anomaly: '🔍 异常',
  concentration: '📊 集中度',
  data_quality: '⚠️ 数据质量',
  trend: '📈 趋势',
  business: '💡 业务',
  attribution: '🎯 归因',
};

/**
 * 主动洞见面板：展示在 assistant 消息顶部
 * - 不喧宾夺主：默认折叠/紧凑，只放 1-3 条
 * - 颜色按 severity 区分
 */
export const InsightsPanel: React.FC<Props> = ({ insights }) => {
  if (!insights || insights.length === 0) return null;

  // 按 severity 排序：critical > warning > info
  const sorted = [...insights].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {sorted.map((ins, i) => {
        const cfg = severityMap[ins.severity];
        return (
          <Alert
            key={i}
            type={cfg.type}
            showIcon
            icon={cfg.icon}
            message={
              <Space size={6} wrap>
                {ins.kind && (
                  <Tag style={{ marginRight: 0 }} bordered={false}>
                    {kindLabel[ins.kind] || ins.kind}
                  </Tag>
                )}
                <Text>{ins.text}</Text>
              </Space>
            }
            style={{ padding: '4px 12px' }}
          />
        );
      })}
    </Space>
  );
};

interface RelatedHintsProps {
  hints?: string[];
  onPick?: (text: string) => void;
}

/**
 * 主动关联提示：用户没问到但 Skill 暗示相关的角度
 * 区别于 followUps：这是"你可能没想到要看"，UI 用浅黄背景突出
 */
export const RelatedHintsPanel: React.FC<RelatedHintsProps> = ({ hints, onPick }) => {
  if (!hints || hints.length === 0) return null;
  return (
    <div
      style={{
        background: '#fffbe6',
        border: '1px solid #ffe58f',
        borderRadius: 6,
        padding: '8px 12px',
        marginTop: 8,
      }}
    >
      <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
        💡 你可能没想到要看：
      </Text>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {hints.map((h, i) => (
          <div
            key={i}
            style={{
              cursor: onPick ? 'pointer' : 'default',
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.6)',
            }}
            onClick={() => onPick?.(h)}
            title={onPick ? '点击直接发为下一轮问题' : undefined}
          >
            • {h}
          </div>
        ))}
      </Space>
    </div>
  );
};

interface FollowUpsProps {
  followUps?: string[];
  onPick: (text: string) => void;
}

/**
 * 下钻建议 chips：展示在 assistant 消息下面
 * 点击 = 自动发送该问题作为下一轮 user message
 */
export const FollowUpChips: React.FC<FollowUpsProps> = ({ followUps, onPick }) => {
  if (!followUps || followUps.length === 0) return null;
  return (
    <Space size={[6, 6]} wrap style={{ marginTop: 6 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        <ThunderboltOutlined /> 继续挖：
      </Text>
      {followUps.map((q, i) => (
        <Tag
          key={i}
          color="blue"
          icon={i === 0 ? <FireOutlined /> : <CheckCircleOutlined />}
          style={{ cursor: 'pointer', userSelect: 'none', padding: '4px 10px' }}
          onClick={() => onPick(q)}
        >
          {q}
        </Tag>
      ))}
    </Space>
  );
};
