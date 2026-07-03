import React, { useEffect, useState } from 'react';
import { Image, Space, Spin, Typography } from 'antd';
import {
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { chatService, ChatAttachmentMeta } from '@/services/chat.service';

const { Text } = Typography;

interface Props {
  ids: string[];
}

/**
 * 用户消息里显示附件卡片
 *
 * image → 缩略图（走 /raw endpoint），点击查看大图
 * 其他 → 图标 + 文件名 + 副标题
 */
export const MessageAttachments: React.FC<Props> = ({ ids }) => {
  const [metas, setMetas] = useState<ChatAttachmentMeta[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ids || ids.length === 0) return;
    let disposed = false;
    setLoading(true);
    Promise.all(ids.map((id) => chatService.getAttachment(id).catch(() => null)))
      .then(async (rs) => {
        if (disposed) return;
        const valid = rs.filter(Boolean) as ChatAttachmentMeta[];
        setMetas(valid);
        // 并行拉 image blob URLs
        const imgUrls: Record<string, string> = {};
        await Promise.all(
          valid
            .filter((m) => m.kind === 'image')
            .map(async (m) => {
              try {
                imgUrls[m.id] = await chatService.getAttachmentBlobUrl(m.id);
              } catch {
                // silent
              }
            }),
        );
        if (!disposed) setThumbUrls(imgUrls);
      })
      .finally(() => !disposed && setLoading(false));
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  // 组件卸载时释放
  useEffect(() => {
    return () => {
      Object.values(thumbUrls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && metas.length === 0) return <Spin size="small" />;
  if (metas.length === 0) return null;

  return (
    <Space wrap size={6} style={{ marginTop: 6 }}>
      {metas.map((m) => {
        if (m.kind === 'image' && thumbUrls[m.id]) {
          // Ant Design Image 组件自带 preview（点击弹大图）
          return (
            <Image
              key={m.id}
              src={thumbUrls[m.id]}
              alt={m.filename}
              width={80}
              height={80}
              style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9' }}
              preview={{ mask: <div style={{ fontSize: 11 }}>点开查看</div> }}
            />
          );
        }
        return (
          <div
            key={m.id}
            style={{
              background: '#fff',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: 260,
            }}
          >
            {renderIcon(m.kind)}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <Text style={{ fontSize: 12 }} ellipsis>{m.filename}</Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {formatSubtitle(m)}
              </Text>
            </div>
          </div>
        );
      })}
    </Space>
  );
};

function renderIcon(kind: string) {
  const style = { fontSize: 18 };
  switch (kind) {
    case 'image':
      return <FileImageOutlined style={{ ...style, color: '#722ed1' }} />;
    case 'table':
      return <FileExcelOutlined style={{ ...style, color: '#52c41a' }} />;
    case 'pdf':
      return <FilePdfOutlined style={{ ...style, color: '#ff4d4f' }} />;
    default:
      return <FileTextOutlined style={{ ...style, color: '#8c8c8c' }} />;
  }
}

function formatSubtitle(m: ChatAttachmentMeta): string {
  const kb = (m.sizeBytes / 1024).toFixed(0);
  if (m.kind === 'table' && m.preview?.columns) {
    return `${m.preview.rowCount || 0} 行 · ${m.preview.columns.length} 列 · ${kb}KB`;
  }
  if (m.kind === 'pdf' && m.preview?.pageCount) {
    return `${m.preview.pageCount} 页 · ${kb}KB`;
  }
  return `${kb}KB`;
}
