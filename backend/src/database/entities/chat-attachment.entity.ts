import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ChatAttachment — 用户在对话里上传的文件
 *
 * 生命周期：
 *   1) 前端上传 → POST /v1/chat/attachments → 创建记录（ownerId + kind + storagePath + preview）
 *   2) 用户发送消息时把 attachment id 塞进 message.attachments []
 *   3) Planner 拿到 message 时读 preview / kind，决定怎么用（vision / in-context / RAG）
 *
 * kind 决定 preview 的形态：
 *   - image:  { width, height, bytes, base64Preview? }（大图不存 base64，读时按需 fromDisk）
 *   - table:  { columns: [{name, type}], rowCount, sampleRows: [][] }（前 100 行样本）
 *   - pdf:    { pageCount, textPreview: string }（前 3000 字文本）
 *   - text:   { lineCount, textPreview: string }
 *
 * 存储：磁盘（storagePath 相对 storage/chat-attachments 根）—— 后续可换 S3
 */
@Entity({ name: 'chat_attachments', schema: 'app' })
export class ChatAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId: string;

  /** 关联到某轮消息（可选 — 上传后不发送时为 null）*/
  @Index()
  @Column({ type: 'uuid', name: 'message_id', nullable: true })
  messageId: string | null;

  @Column({ type: 'varchar', length: 20 })
  kind: 'image' | 'table' | 'pdf' | 'text';

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: number;

  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;

  /** 解析结果 —— 结构由 kind 决定 */
  @Column({ type: 'jsonb', nullable: true })
  preview: Record<string, any> | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
