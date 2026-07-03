/**
 * LiveTurnBubble — 流式渲染一个正在跑的 turn。
 *
 * 显示：
 *   - 顶部 Skill / Mode 标签 + 实时时长 / token 计数
 *   - LLM 思考中状态（spinner + "step N 在思考..."）
 *   - 每个工具调用 step（图标 + 工具名 + 耗时 + 折叠输出）
 *   - sub-agent 派遣（Master 模式）
 *   - 最终 finalize 出现后由 ChatPage 替换成完整 MessageBubble，本组件卸载
 */
import React, { useEffect, useState } from 'react';
import { Card, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CodeOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { StreamingTurnState, ReasoningStep, SubAgentRun } from '@/hooks/useStreamingTurn';

const { Text, Paragraph } = Typography;

interface Props {
  state: StreamingTurnState;
}

/** 让数字"动起来"的时长计时器 */
function useTickingDuration(startedAt: number | null, frozen: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (frozen || !startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt, frozen]);
  if (!startedAt) return 0;
  return now - startedAt;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function toolIcon(name: string) {
  if (name.includes('sql')) return <CodeOutlined />;
  if (name === 'finalize' || name === 'finalize_master') return <CheckCircleFilled style={{ color: '#52c41a' }} />;
  if (name === 'run_skill_agent') return <ThunderboltOutlined style={{ color: '#1677ff' }} />;
  return <ToolOutlined />;
}

function StepRow({ step }: { step: ReasoningStep }) {
  const isDone = step.status === 'done';
  const isErr = step.status === 'error';
  const isRunning = step.status === 'running';
  const argPreview =
    step.toolName === 'run_sql' && step.args?.sql
      ? String(step.args.sql).replace(/\s+/g, ' ').substring(0, 80)
      : step.args
        ? JSON.stringify(step.args).substring(0, 80)
        : '';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 0',
        fontSize: 13,
      }}
    >
      <span style={{ width: 18, marginTop: 2 }}>
        {isRunning ? <LoadingOutlined spin /> : isErr ? <CloseCircleFilled style={{ color: '#ff4d4f' }} /> : toolIcon(step.toolName)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={6} wrap>
          <Text strong>{step.toolName}</Text>
          {isDone && step.durationMs != null && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmtMs(step.durationMs)}
            </Text>
          )}
          {isDone && step.toolName === 'run_sql' && step.output?.rowCount != null && (
            <Tag color="green" style={{ margin: 0 }}>
              {step.output.rowCount} 行
            </Tag>
          )}
        </Space>
        {argPreview && (
          <div
            style={{
              color: '#888',
              fontSize: 11,
              fontFamily: 'Menlo, monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {argPreview}
          </div>
        )}
        {isErr && step.error && (
          <Text type="danger" style={{ fontSize: 11 }}>
            ⚠ {step.error}
          </Text>
        )}
      </div>
    </div>
  );
}

function SubAgentRow({ run }: { run: SubAgentRun }) {
  const isRunning = run.status === 'running';
  return (
    <div
      style={{
        padding: 8,
        background: 'rgba(22, 119, 255, 0.04)',
        border: '1px solid rgba(22, 119, 255, 0.15)',
        borderRadius: 6,
        marginBottom: 6,
      }}
    >
      <Space size={6} wrap>
        {isRunning ? <Spin size="small" /> : <CheckCircleFilled style={{ color: '#52c41a' }} />}
        <Tag color="purple" style={{ margin: 0 }}>
          子 Agent · {run.skillName}
        </Tag>
        {!isRunning && run.rowCount != null && (
          <Tag color="green" style={{ margin: 0 }}>
            {run.rowCount} 行
          </Tag>
        )}
        {!isRunning && run.durationMs != null && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {fmtMs(run.durationMs)}
          </Text>
        )}
      </Space>
      <Tooltip title={run.subQuestion}>
        <div
          style={{
            fontSize: 12,
            color: '#666',
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {run.subQuestion}
        </div>
      </Tooltip>
      {!isRunning && run.narrative && (
        <Paragraph
          style={{ fontSize: 12, marginTop: 6, marginBottom: 0, color: '#444' }}
          ellipsis={{ rows: 2 }}
        >
          {run.narrative}
        </Paragraph>
      )}
    </div>
  );
}

export const LiveTurnBubble: React.FC<Props> = ({ state }) => {
  const frozen = state.status === 'done' || state.status === 'error';
  const elapsedMs = useTickingDuration(state.startedAt, frozen);

  // 错误态：单独显示
  if (state.status === 'error') {
    return (
      <Card
        size="small"
        style={{ marginBottom: 12, borderColor: '#ffccc7', background: '#fff2f0' }}
      >
        <Space>
          <CloseCircleFilled style={{ color: '#ff4d4f' }} />
          <Text type="danger">出错：{state.errorMessage || '未知错误'}</Text>
        </Space>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        borderColor: state.status === 'paused_clarify' ? '#ffe58f' : '#91caff',
        background: state.status === 'paused_clarify' ? '#fffbe6' : '#f5faff',
      }}
      bodyStyle={{ padding: 12 }}
    >
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        {state.mode === 'master' ? (
          <Tag color="purple">Master 调度</Tag>
        ) : (
          <Tag color="blue">单 Skill</Tag>
        )}
        {state.skill && (
          <Tag color="geekblue" style={{ margin: 0 }}>
            {state.skill.name}
          </Tag>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {fmtMs(elapsedMs)} · {state.totalTokens} tokens · {state.steps.length} 步
        </Text>
        {state.status === 'streaming' && state.llmThinking != null && (
          <Tag icon={<LoadingOutlined spin />} color="processing" style={{ margin: 0 }}>
            思考中 (step {state.llmThinking})
          </Tag>
        )}
        {state.status === 'paused_clarify' && (
          <Tag color="warning" style={{ margin: 0 }}>
            等你确认...
          </Tag>
        )}
        {state.status === 'done' && (
          <Tag icon={<LoadingOutlined spin />} color="success" style={{ margin: 0 }}>
            生成最终报告中...
          </Tag>
        )}
      </Space>

      {state.resolvedClarifyAnswer && (
        <div
          style={{
            padding: '4px 8px',
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 4,
            fontSize: 12,
            color: '#389e0d',
            marginBottom: 8,
          }}
        >
          ✓ 已确认：{state.resolvedClarifyAnswer}
        </div>
      )}

      {/* Master 模式：子 agent 派遣区 */}
      {state.subAgents.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {state.subAgents.map((sa, i) => (
            <SubAgentRow key={`${sa.step}-${sa.skillName}-${i}`} run={sa} />
          ))}
        </div>
      )}

      {/* 工具调用步骤（single skill 路径下是 list/describe/run_sql；master 下是 list_available_skills 等）*/}
      <div>
        {state.steps.map((s, i) => (
          <StepRow key={`${s.step}-${s.toolName}-${i}`} step={s} />
        ))}
      </div>
    </Card>
  );
};
