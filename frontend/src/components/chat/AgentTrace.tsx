import React from 'react';
import { Collapse, Tag, Typography, Alert, Space } from 'antd';
import {
  BranchesOutlined,
  CheckCircleTwoTone,
  WarningTwoTone,
  ToolOutlined,
} from '@ant-design/icons';
import type { ProvenanceFooter, ToolCallLog } from '@/types';

const { Text, Paragraph } = Typography;

interface Props {
  provenance: ProvenanceFooter;
  confidence?: number;
  refused?: boolean;
}

/**
 * Agent 推理轨迹面板
 * 显示：使用的 Skill、每一步 Tool 调用、Reviewer 审查结果
 */
export const AgentTrace: React.FC<Props> = ({ provenance, confidence, refused }) => {
  if (!provenance) return null;
  const { skill, steps, totalLatencyMs, totalTokens, review } = provenance;

  return (
    <Collapse
      size="small"
      ghost
      items={[
        {
          key: 'trace',
          label: (
            <Space size={8} wrap>
              <BranchesOutlined />
              <Text strong>Agent 推理轨迹</Text>
              <Tag color="purple">Skill: {skill.name} v{skill.version}</Tag>
              <Tag color="geekblue">{steps.length} 步</Tag>
              <Tag>{(totalLatencyMs / 1000).toFixed(1)}s</Tag>
              {totalTokens > 0 && <Tag>{totalTokens.toLocaleString()} tokens</Tag>}
              {typeof confidence === 'number' && (
                <Tag color={confidence >= 0.8 ? 'green' : confidence >= 0.5 ? 'orange' : 'red'}>
                  <CheckCircleTwoTone twoToneColor={confidence >= 0.5 ? '#52c41a' : '#ff4d4f'} />{' '}
                  置信度 {(confidence * 100).toFixed(0)}%
                </Tag>
              )}
              {refused && <Tag color="red">已拒答</Tag>}
            </Space>
          ),
          children: (
            <div style={{ fontSize: 12 }}>
              {/* Reviewer 审查报告 */}
              {review && (
                <Alert
                  type={review.concerns.length > 0 ? 'warning' : 'success'}
                  showIcon
                  icon={
                    review.concerns.length > 0 ? (
                      <WarningTwoTone twoToneColor="#faad14" />
                    ) : (
                      <CheckCircleTwoTone twoToneColor="#52c41a" />
                    )
                  }
                  message={
                    <Text strong>
                      Reviewer 审查 · 置信度 {(review.confidence * 100).toFixed(0)}%
                    </Text>
                  }
                  description={
                    <>
                      {review.summary && (
                        <Paragraph style={{ marginBottom: review.concerns.length ? 8 : 0 }}>
                          {review.summary}
                        </Paragraph>
                      )}
                      {review.concerns.length > 0 && (
                        <ul style={{ paddingLeft: 18, margin: 0 }}>
                          {review.concerns.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  }
                  style={{ marginBottom: 12 }}
                />
              )}

              {/* Tool 调用时间线 */}
              {steps.length === 0 ? (
                <Text type="secondary">（没有工具调用记录）</Text>
              ) : (
                <div style={{ borderLeft: '2px solid #e6f4ff', paddingLeft: 12 }}>
                  {steps.map((step, idx) => (
                    <ToolCallItem key={idx} step={step} />
                  ))}
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
};

const ToolCallItem: React.FC<{ step: ToolCallLog }> = ({ step }) => {
  const hasError = !!step.error;
  return (
    <div style={{ marginBottom: 12 }}>
      <Space size={6} wrap style={{ marginBottom: 4 }}>
        <ToolOutlined style={{ color: hasError ? '#ff4d4f' : '#1677ff' }} />
        <Text strong style={{ color: hasError ? '#ff4d4f' : undefined }}>
          [step {step.step}] {step.name}
        </Text>
        <Tag color="default">{step.durationMs}ms</Tag>
        {hasError && <Tag color="red">错误</Tag>}
      </Space>
      <div style={{ marginLeft: 22 }}>
        {Object.keys(step.input || {}).length > 0 && (
          <pre
            style={{
              background: '#f5f5f5',
              padding: 6,
              borderRadius: 4,
              margin: '4px 0',
              fontSize: 11,
              maxHeight: 100,
              overflow: 'auto',
            }}
          >
            <span style={{ color: '#888' }}>入参:</span>{' '}
            {JSON.stringify(step.input, null, 2)}
          </pre>
        )}
        {hasError ? (
          <Text type="danger" style={{ fontSize: 11 }}>
            {step.error}
          </Text>
        ) : (
          <pre
            style={{
              background: '#fafafa',
              padding: 6,
              borderRadius: 4,
              margin: '4px 0',
              fontSize: 11,
              maxHeight: 160,
              overflow: 'auto',
            }}
          >
            <span style={{ color: '#888' }}>结果:</span>{' '}
            {summarize(step.output)}
          </pre>
        )}
      </div>
    </div>
  );
};

function summarize(output: any): string {
  if (output === null || output === undefined) return 'null';
  if (typeof output !== 'object') return String(output);
  try {
    const s = JSON.stringify(output, null, 2);
    return s.length > 1500 ? s.substring(0, 1500) + '\n... (truncated)' : s;
  } catch {
    return String(output);
  }
}
