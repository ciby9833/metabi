/**
 * AttachmentChips — chat 消息底部展示 AI 生成的导出附件
 *
 * 设计：
 *   - 不嵌入消息正文（避免 narrative 渲染冲突）
 *   - 一个 conversation 的所有附件按 createdAt 倒序展示
 *   - 点击 chip 直接触发下载（带 token）
 *   - 文件 mime 自动选 icon
 */
import React, { useEffect, useState } from 'react';
import { App, Space, Tag, Tooltip, Typography } from 'antd';
import {
  FileExcelOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  FileOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { fileService, ExportedFileMeta } from '@/services';

interface Props {
  conversationId: string | null | undefined;
  /** 仅在 turn 完成后触发刷新（finalize 事件出现时）*/
  refreshKey?: number;
}

const { Text } = Typography;

function pickIcon(mime: string) {
  if (mime.includes('excel') || mime.includes('spreadsheet'))
    return <FileExcelOutlined style={{ color: '#1d6f42' }} />;
  if (mime.includes('csv') || mime.includes('text/plain'))
    return <FileTextOutlined style={{ color: '#595959' }} />;
  if (mime.includes('pdf')) return <FilePdfOutlined style={{ color: '#c1272d' }} />;
  return <FileOutlined />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const AttachmentChips: React.FC<Props> = ({ conversationId, refreshKey }) => {
  const { message } = App.useApp();
  const [files, setFiles] = useState<ExportedFileMeta[]>([]);

  useEffect(() => {
    if (!conversationId) {
      setFiles([]);
      return;
    }
    void fileService
      .list(conversationId)
      .then(setFiles)
      .catch(() => {
        /* 静默 — 附件可能没生成 */
      });
  }, [conversationId, refreshKey]);

  if (!conversationId || files.length === 0) return null;

  const onDownload = async (f: ExportedFileMeta) => {
    try {
      await fileService.download(f.id, f.filename);
    } catch (err: any) {
      message.error(`下载失败：${err.message || err}`);
    }
  };

  return (
    <div
      style={{
        padding: '8px 16px',
        borderTop: '1px dashed #f0f0f0',
        background: '#fafafa',
      }}
    >
      <Space size={[8, 8]} wrap>
        <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>
          📎 AI 生成的附件（{files.length}）
        </Text>
        {files.map((f) => (
          <Tooltip
            key={f.id}
            title={
              <div style={{ fontSize: 12 }}>
                {f.description && <div>{f.description}</div>}
                <div>大小：{formatBytes(f.sizeBytes)}</div>
                <div>生成：{new Date(f.createdAt).toLocaleString('zh-CN')}</div>
              </div>
            }
          >
            <Tag
              icon={pickIcon(f.mimeType)}
              color="default"
              style={{
                cursor: 'pointer',
                padding: '2px 10px',
                border: '1px solid #d9d9d9',
                background: '#fff',
              }}
              onClick={() => void onDownload(f)}
            >
              <Space size={4}>
                <span>{f.filename}</span>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  ({formatBytes(f.sizeBytes)})
                </Text>
                <DownloadOutlined style={{ fontSize: 12 }} />
              </Space>
            </Tag>
          </Tooltip>
        ))}
      </Space>
    </div>
  );
};
