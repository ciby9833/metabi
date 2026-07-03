import React, { useMemo, useRef, useState } from 'react';
import { App, Button, Input, Mentions, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CloseOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  PaperClipOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { UserDataset } from '@/types';
import { chatService, ChatAttachmentMeta } from '@/services/chat.service';

/**
 * @ 联想的字段来源 — 统一形状，dataset / 企业两种模式都用它
 */
export interface MentionField {
  name: string;
  type?: string;
  description?: string;
  /** 出处（表名 / dataset 显示名），用于消歧同名列 */
  source?: string;
}

interface Props {
  disabled?: boolean;
  loading?: boolean;
  onSend: (text: string, attachmentIds?: string[]) => void;
  placeholder?: string;
  /**
   * @ 联想字段。传空数组 = 关闭联想。
   * dataset 模式：从 activeDatasets.columns 组装；
   * 企业模式：从 analyzedColumns（按表分组的字段）组装。
   */
  mentionFields?: MentionField[];
  /** 字段正在加载 — 会显示 loading placeholder，避免用户以为坏了 */
  mentionLoading?: boolean;
  /** 兼容旧调用签名（dataset 模式）— 内部转成 mentionFields */
  activeDatasets?: UserDataset[];
}

/**
 * ChatInput with @ mention support
 *
 * 设计：
 *   - 输入 @ 触发 dataset 字段列表；打字过滤
 *   - 显示：`col_name (type) · description`
 *   - 插入格式：`@col_name`
 *   - 用户提交时 raw text 保留 @xxx；后端识别并强化 prompt
 */
export const ChatInput: React.FC<Props> = ({
  disabled,
  loading,
  onSend,
  placeholder,
  mentionFields,
  mentionLoading,
  activeDatasets,
}) => {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachmentMeta[]>([]);
  /** attachment.id → 本地 blob URL（image 缩略图）*/
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 卸载时释放所有 blob URL
  React.useEffect(() => {
    return () => {
      Object.values(thumbUrls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      message.error(`${file.name} 超过 20MB`);
      return;
    }
    setUploading((n) => n + 1);
    try {
      const meta = await chatService.uploadAttachment(file);
      setAttachments((prev) => [...prev, meta]);
      // image 用本地 File 直接生成 blob URL 作缩略图（不走网络）
      if (meta.kind === 'image') {
        const url = URL.createObjectURL(file);
        setThumbUrls((prev) => ({ ...prev, [meta.id]: url }));
      }
    } catch (err: any) {
      message.error(`上传失败：${err.response?.data?.message || err.message}`);
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const handlePickFiles = () => fileInputRef.current?.click();

  const onFilesSelected = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => void uploadFile(f));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setThumbUrls((prev) => {
      const url = prev[id];
      if (url) URL.revokeObjectURL(url);
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length > 0) {
      e.preventDefault();
      files.forEach((f) => void uploadFile(f));
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) files.forEach((f) => void uploadFile(f));
  };

  // 归一化两种输入 → MentionField[]
  const normalizedFields = useMemo<MentionField[]>(() => {
    if (mentionFields && mentionFields.length > 0) return mentionFields;
    if (!activeDatasets || activeDatasets.length === 0) return [];
    const out: MentionField[] = [];
    for (const ds of activeDatasets) {
      for (const c of ds.columns || []) {
        if (c.skipped) continue;
        out.push({
          name: c.name,
          type: c.type,
          description: c.description || (c.originalName ? `原：${c.originalName}` : undefined),
          source: ds.displayName,
        });
      }
    }
    return out;
  }, [mentionFields, activeDatasets]);

  // 去重 + 渲染 options
  const fieldOptions = useMemo(() => {
    const seen = new Set<string>();
    return normalizedFields
      .filter((f) => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      })
      .map((f) => ({
        value: f.name,
        key: f.name,
        label: (
          <Space size={6} style={{ fontSize: 12 }}>
            <code style={{ background: '#f5f5f5', padding: '0 4px' }}>{f.name}</code>
            {f.type && (
              <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>
                {f.type}
              </Tag>
            )}
            {f.source && (
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                来自 {f.source}
              </Typography.Text>
            )}
            {f.description && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {f.description.substring(0, 40)}
              </Typography.Text>
            )}
          </Space>
        ),
      }));
  }, [normalizedFields]);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled || loading || uploading > 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments.map((a) => a.id) : undefined);
    setText('');
    setAttachments([]);
    // 释放本地 blob URL —— 发送后消息里的缩略图走 /raw endpoint，不复用这些
    Object.values(thumbUrls).forEach((u) => URL.revokeObjectURL(u));
    setThumbUrls({});
  };

  const hasMentions = fieldOptions.length > 0;
  // 优雅的 placeholder：区分 loading / 有字段 / 无字段
  const loadingPlaceholder = mentionLoading
    ? '⏳ 字段加载中，稍等就能 @ 联想字段...'
    : null;

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ width: '100%' }}
    >
      {/* 已上传附件 chip 区 */}
      {(attachments.length > 0 || uploading > 0) && (
        <div
          style={{
            marginBottom: 6,
            padding: '4px 6px',
            background: '#f5f5f5',
            borderRadius: 4,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {attachments.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 6px 2px 2px',
                background: '#fff',
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              {a.kind === 'image' && thumbUrls[a.id] ? (
                <img
                  src={thumbUrls[a.id]}
                  alt={a.filename}
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: 'cover',
                    borderRadius: 2,
                  }}
                />
              ) : (
                <span style={{ padding: '0 4px' }}>{renderKindIcon(a.kind)}</span>
              )}
              <div style={{ maxWidth: 180 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.filename}
                </div>
                {a.kind === 'table' && a.preview?.rowCount != null && (
                  <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                    {a.preview.rowCount}行 × {a.preview.columns?.length || 0}列
                  </Typography.Text>
                )}
              </div>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined style={{ fontSize: 10 }} />}
                onClick={() => removeAttachment(a.id)}
              />
            </div>
          ))}
          {uploading > 0 && (
            <Tag color="processing" style={{ fontSize: 11 }}>
              ⏳ {uploading} 个上传中…
            </Tag>
          )}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        accept="image/*,.pdf,.csv,.xlsx,.xls,.txt,.md,.json"
        onChange={(e) => onFilesSelected(e.target.files)}
      />
      <Space.Compact style={{ width: '100%' }}>
      <Tooltip title="上传图片/表格/PDF/文本（也支持拖拽或粘贴）">
        <Button
          icon={<PaperClipOutlined />}
          onClick={handlePickFiles}
          disabled={disabled || loading}
          style={{ height: 'auto' }}
        />
      </Tooltip>
      {hasMentions ? (
        <Mentions
          value={text}
          onChange={(v) => setText(v || '')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onPaste={onPaste}
          options={fieldOptions}
          prefix="@"
          placeholder={
            placeholder ||
            '💬 输入你的问题 — 输 @ 可选字段，例如：「按 @customer 分组算 @amount 合计」'
          }
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={disabled || loading}
          style={{ width: '100%', fontSize: 14 }}
        />
      ) : (
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onPaste={onPaste}
          placeholder={
            loadingPlaceholder ||
            placeholder ||
            '💬 输入你的问题，例如：「新产品昨天每小时的订单数」（可拖拽/粘贴文件）'
          }
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={disabled || loading}
        />
      )}
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        disabled={disabled || uploading > 0 || (!text.trim() && attachments.length === 0)}
        loading={loading}
        style={{ height: 'auto' }}
      >
        发送
      </Button>
      </Space.Compact>
    </div>
  );
};

function renderKindIcon(kind: 'image' | 'table' | 'pdf' | 'text') {
  switch (kind) {
    case 'image':
      return <FileImageOutlined style={{ color: '#722ed1' }} />;
    case 'table':
      return <FileExcelOutlined style={{ color: '#52c41a' }} />;
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#ff4d4f' }} />;
    default:
      return <FileTextOutlined style={{ color: '#8c8c8c' }} />;
  }
}
