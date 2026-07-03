import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ExportedFile — AI 生成的导出文件（Excel / CSV / 未来的 PDF/PPT）
 *
 * 设计原则：
 *   - LLM 调 export_to_excel 工具后，生成的文件元数据存这里
 *   - 实际文件落到 disk（FileStorageService 负责），DB 只存元数据
 *   - 关联 conversationId/messageId 是可选的 — 工具调用上下文有就填，无也能用
 *
 * 权限：
 *   - owner 自己可访问
 *   - 若挂在 conversation 上，且 conversation 是 project conv → project member 可访问
 */
@Entity({ name: 'exported_files', schema: 'app' })
export class ExportedFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 生成者（永远是 owner，不可转移）*/
  @Index()
  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId: string;

  /** 可选：生成时所属对话 */
  @Index()
  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId: string | null;

  /** 可选：触发生成的 assistant message id */
  @Column({ type: 'uuid', name: 'message_id', nullable: true })
  messageId: string | null;

  /** 用户友好的文件名（含扩展名），如 "客户表-2026-06.xlsx" */
  @Column({ type: 'varchar', length: 255 })
  filename: string;

  /** MIME，如 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" */
  @Column({ type: 'varchar', length: 100, name: 'mime_type' })
  mimeType: string;

  /** 文件大小（bytes）*/
  @Column({ type: 'bigint', name: 'size_bytes' })
  sizeBytes: number;

  /** 磁盘相对路径 — FileStorageService 解析为绝对路径 */
  @Column({ type: 'varchar', length: 500, name: 'storage_path' })
  storagePath: string;

  /** 简短描述（如"5月客户订单分析结果"），给前端附件 chip 显示用 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
