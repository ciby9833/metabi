/**
 * ClarifyOverlay — Claude-style 浮在输入框上方的澄清面板。
 *
 * 触发：streaming turn yield 了 clarify_request → state.pendingClarify 非空。
 * 用户答 → onAnswer(text) → submitAnswer → SSE 续推 → overlay 自动隐藏。
 *
 * vs 老 ClarifyCard：
 *   - 不嵌在消息流中（避免污染对话历史视觉）
 *   - 浮在输入框上方（绝对定位）
 *   - 选项带 pros/cons popover + 推荐徽章
 *   - 同 turn 内一直浮着，用户答完后立刻消失
 */
import React, { useState } from 'react';
import { Button, Input, Popover, Space, Tag, Typography } from 'antd';
import {
  CloseOutlined,
  InfoCircleOutlined,
  SendOutlined,
  StarFilled,
} from '@ant-design/icons';
import type { PendingClarify, ClarifyOption } from '@/hooks/useStreamingTurn';

const { Text } = Typography;

interface Props {
  clarify: PendingClarify;
  onAnswer: (answer: string) => void;
  /** 可选：手动关闭（取消澄清） — 当前不实现，留 hook */
  onCancel?: () => void;
  disabled?: boolean;
}

export const ClarifyOverlay: React.FC<Props> = ({ clarify, onAnswer, onCancel, disabled }) => {
  const [custom, setCustom] = useState('');

  const handleSend = () => {
    const v = custom.trim();
    if (!v || disabled) return;
    onAnswer(v);
    setCustom('');
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 90, // 浮在输入框上方
        zIndex: 50,
        background: '#fffbe6',
        border: '1.5px solid #ffe58f',
        borderRadius: 10,
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.08)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <Space size={6} style={{ marginBottom: 2 }}>
            <Tag color="warning" style={{ margin: 0 }}>需要你确认</Tag>
          </Space>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#222' }}>{clarify.question}</div>
          {clarify.reason && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              💡 {clarify.reason}
            </Text>
          )}
        </div>
        {onCancel && (
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onCancel} />
        )}
      </div>

      {/* 选项 — 带优劣评注 popover */}
      {clarify.options && clarify.options.length > 0 && (
        <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 10 }}>
          {clarify.options.map((opt, idx) => (
            <OptionTag key={`${opt.value}-${idx}`} opt={opt} disabled={disabled} onClick={onAnswer} />
          ))}
        </Space>
      )}

      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder="或者用你自己的话补充..."
          value={custom}
          disabled={disabled}
          onChange={(e) => setCustom(e.target.value)}
          onPressEnter={handleSend}
          size="middle"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          disabled={disabled || !custom.trim()}
          onClick={handleSend}
        >
          发送
        </Button>
      </Space.Compact>
    </div>
  );
};

function OptionTag({
  opt,
  disabled,
  onClick,
}: {
  opt: ClarifyOption;
  disabled?: boolean;
  onClick: (v: string) => void;
}) {
  const hasMeta = !!(opt.pros || opt.cons);
  const tag = (
    <Tag
      color={opt.recommended ? 'gold' : 'blue'}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '6px 12px',
        fontSize: 13,
        opacity: disabled ? 0.5 : 1,
        borderWidth: opt.recommended ? 1.5 : 1,
      }}
      onClick={() => !disabled && onClick(opt.value)}
    >
      {opt.recommended && <StarFilled style={{ marginRight: 4, fontSize: 11 }} />}
      {opt.value}
      {opt.recommended && (
        <Text style={{ marginLeft: 6, fontSize: 11, color: '#d48806' }}>推荐</Text>
      )}
      {hasMeta && <InfoCircleOutlined style={{ marginLeft: 6, fontSize: 11, color: '#999' }} />}
    </Tag>
  );
  if (!hasMeta) return tag;
  return (
    <Popover
      placement="right"
      content={
        <div style={{ maxWidth: 280, fontSize: 12 }}>
          {opt.pros && (
            <div style={{ marginBottom: 4 }}>
              <Text type="success" strong>✓ 优点：</Text>
              <Text>{opt.pros}</Text>
            </div>
          )}
          {opt.cons && (
            <div>
              <Text type="warning" strong>⚠ 注意：</Text>
              <Text>{opt.cons}</Text>
            </div>
          )}
        </div>
      }
    >
      {tag}
    </Popover>
  );
}
