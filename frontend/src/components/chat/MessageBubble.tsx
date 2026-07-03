import React, { useRef } from 'react';
import { Avatar, Card, Space, Tag, Typography } from 'antd';
import { UserOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Message } from '@/types';
import { ChartRenderer } from '../chart/ChartRenderer';
import { SqlPanel } from './SqlPanel';
import { AgentTrace } from './AgentTrace';
import { FeedbackBar } from './FeedbackBar';
import { FollowUpChips, InsightsPanel, RelatedHintsPanel } from './InsightsPanel';
import { LineageBadges } from './LineageBadges';
import { ExportMenu } from './ExportMenu';
import { SaveToDashboardButton } from './SaveToDashboardButton';
import { MarkdownContent } from './MarkdownContent';
import { MessageAttachments } from './MessageAttachments';

const { Text } = Typography;

interface Props {
  message: Message;
  /** 用户点击下钻 chip / 关联提示时调，把问题发回上层去发送 */
  onPickFollowUp?: (text: string) => void;
}

/** narrative 第一句话取前 30 字作为下载文件名前缀 */
function truncateForFilename(text: string): string {
  if (!text) return 'chart';
  const cleaned = text.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-');
  return cleaned.substring(0, 30) || 'chart';
}

export const MessageBubble: React.FC<Props> = ({
  message,
  onPickFollowUp,
}) => {
  const isUser = message.role === 'user';
  const meta = message.metadata;
  const refused = !!meta?.refused;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canExport = !isUser && !refused && !!message.sqlText && !message.id.startsWith('temp-');

  // 拒答时的视觉样式：橘红边框
  const assistantBg = refused ? '#fff7e6' : '#f6ffed';
  const assistantBorder = refused ? '#ffd591' : '#b7eb8f';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <Avatar
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{
          backgroundColor: isUser ? '#1677ff' : refused ? '#fa8c16' : '#52c41a',
          flexShrink: 0,
        }}
      />
      <div style={{ maxWidth: 'calc(100% - 60px)', flex: 1 }} ref={cardRef}>
        <Card
          size="small"
          style={{
            background: isUser ? '#e6f4ff' : assistantBg,
            border: `1px solid ${isUser ? '#91caff' : assistantBorder}`,
          }}
          styles={{ body: { padding: 12 } }}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {/* 拒答的视觉标记 */}
            {!isUser && refused && (
              <Tag color="orange" style={{ marginBottom: 4 }}>
                Agent 拒答 · 置信度 {((meta?.confidence || 0) * 100).toFixed(0)}%
              </Tag>
            )}

            {/* 主动洞见（在播报之前展示） */}
            {!isUser && !refused && meta?.insights && meta.insights.length > 0 && (
              <InsightsPanel insights={meta.insights} />
            )}

            {/* 主播报 —— user 消息保持原样文本；assistant 走 markdown 渲染 */}
            {isUser ? (
              <Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {message.content}
              </Text>
            ) : (
              <MarkdownContent content={message.content} />
            )}

            {/* 附件卡片（仅 user 消息可能带）*/}
            {isUser && message.attachments && message.attachments.length > 0 && (
              <MessageAttachments ids={message.attachments} />
            )}

            {/* 拒答提示原因 */}
            {!isUser && refused && meta?.refuseReason && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                💡 {meta.refuseReason}
              </Text>
            )}

            {/* 图表 */}
            {!isUser && message.chartConfig && !refused && (
              <div
                style={{
                  background: '#fff',
                  borderRadius: 6,
                  padding: 12,
                  border: '1px solid #d9d9d9',
                }}
              >
                <ChartRenderer
                  config={message.chartConfig}
                  columnDisplayMap={meta?.columnDisplayMap}
                  exportFileName={truncateForFilename(message.content)}
                />
              </div>
            )}

            {/* SQL 详情 */}
            {!isUser && message.sqlText && (
              <SqlPanel
                sql={message.sqlText}
                confidence={meta?.confidence}
                executionTimeMs={meta?.executionTimeMs}
                fromCache={meta?.fromCache}
                rowCount={message.resultData?.rowCount}
              />
            )}

            {/* 数据血缘 badges */}
            {!isUser && !refused && meta?.lineage && meta.lineage.length > 0 && (
              <LineageBadges lineage={meta.lineage} />
            )}

            {/* 主动关联提示（黄色卡片，区别于 followUps）*/}
            {!isUser && !refused && meta?.relatedHints && meta.relatedHints.length > 0 && (
              <RelatedHintsPanel
                hints={meta.relatedHints}
                onPick={onPickFollowUp}
              />
            )}

            {/* 下钻建议 chips */}
            {!isUser && !refused && onPickFollowUp && (
              <FollowUpChips
                followUps={meta?.suggestedFollowUps}
                onPick={onPickFollowUp}
              />
            )}

            {/* Agent 推理轨迹 */}
            {!isUser && meta?.provenance && (
              <AgentTrace
                provenance={meta.provenance}
                confidence={meta.confidence}
                refused={meta.refused}
              />
            )}
          </Space>
        </Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {dayjs(message.createdAt).format('YYYY-MM-DD HH:mm:ss')}
          </Text>
          <Space size={6}>
            {canExport && (
              <SaveToDashboardButton
                messageId={message.id}
                suggestedTitle={truncateForFilename(message.content)}
                suggestedChartType={(meta as any)?.chartType || 'table'}
                sql={message.sqlText}
              />
            )}
            {canExport && (
              <ExportMenu
                messageId={message.id}
                getCardElement={() => cardRef.current}
                filenamePrefix={truncateForFilename(message.content)}
              />
            )}
            {!isUser && !message.id.startsWith('temp-') && (
              <FeedbackBar
                messageId={message.id}
                disabled={refused}
                hasSql={!!message.sqlText}
              />
            )}
          </Space>
        </div>
      </div>
    </div>
  );
};
