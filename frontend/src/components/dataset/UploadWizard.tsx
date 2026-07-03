/**
 * 3 步上传 wizard — Claude-style 数据导入体验。
 *
 *   Step 1: 拖拽上传 → 后端同步解析 ~3-5s 返回推断 schema
 *   Step 2: 用户编辑 schema（列名 / 类型 / 描述 / 跳过）
 *   Step 3: 确认归属（Personal / Project + 成员预览警告）+ 入库
 *
 * 失败回滚：任意步骤失败可重新上传；不污染列表（dataset.status=failed 仍可看）。
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Steps,
  Tag,
  Tooltip,
  Typography,
  Upload,
  App,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  EditOutlined,
  EyeOutlined,
  InboxOutlined,
  LoadingOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  DatasetColumn,
  DatasetColumnType,
  UserDataset,
} from '@/types';
import { datasetService, projectService, Project } from '@/services';

const { Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface Props {
  open: boolean;
  /** 预选 project（从某 project 详情页打开时）*/
  defaultProjectId?: string | null;
  onClose: () => void;
  /** 完成时把新 dataset 抛给上层 — 用来刷新列表 */
  onDone: (dataset: UserDataset) => void;
}

type Stage = 0 | 1 | 2;

const TYPE_OPTIONS: { value: DatasetColumnType; label: string; color: string }[] = [
  { value: 'text', label: '文本', color: 'default' },
  { value: 'integer', label: '整数', color: 'blue' },
  { value: 'numeric', label: '数值', color: 'cyan' },
  { value: 'boolean', label: '布尔', color: 'orange' },
  { value: 'date', label: '日期', color: 'purple' },
  { value: 'timestamp', label: '时间戳', color: 'magenta' },
];

export const UploadWizard: React.FC<Props> = ({
  open,
  defaultProjectId,
  onClose,
  onDone,
}) => {
  const { message } = App.useApp();
  const [stage, setStage] = useState<Stage>(0);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Stage 1 产出
  const [dataset, setDataset] = useState<UserDataset | null>(null);
  // Stage 2 用户编辑
  const [columns, setColumns] = useState<DatasetColumn[]>([]);
  // Stage 3 项目归属（dataset 必属于某个 project；默认 personal workspace）
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId || null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [confirming, setConfirming] = useState(false);

  // 数据集元数据
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      void projectService.list().then((list) => {
        setProjects(list);
        // 自动预选：defaultProjectId 优先，否则 personal workspace，否则第一个
        if (!projectId) {
          const personalWs = list.find((p) => (p as any).isPersonalWorkspace);
          setProjectId(defaultProjectId || personalWs?.id || list[0]?.id || null);
        }
      });
    } else {
      // 关闭时重置
      setTimeout(() => {
        setStage(0);
        setDataset(null);
        setColumns([]);
        setProjectId(defaultProjectId || null);
        setDisplayName('');
        setDescription('');
        setUploadPct(0);
      }, 300);
    }
    // projectId 不该作为依赖（避免反复刷新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProjectId]);

  // === Stage 1: 上传 ===
  const uploadProps: UploadProps = {
    accept: '.csv,.xlsx,.xls',
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      if (file.size > 50 * 1024 * 1024) {
        message.error('文件超过 50MB 上限');
        return Upload.LIST_IGNORE;
      }
      void handleFile(file);
      return false; // 阻止 antd 默认上传
    },
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadPct(0);
    try {
      const ds = await datasetService.upload(file, (pct) => setUploadPct(pct));
      setDataset(ds);
      setColumns(ds.columns || []);
      setDisplayName(ds.displayName);
      setStage(1);
    } catch (err: any) {
      message.error(
        `上传失败：${err.response?.data?.message || err.message || '未知错误'}`,
      );
    } finally {
      setUploading(false);
    }
  };

  // === Stage 2: 编辑列 ===
  const updateColumn = (idx: number, patch: Partial<DatasetColumn>) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const allSkipped = columns.every((c) => c.skipped);

  // === Stage 3: 确认归属并入库 ===
  const handleConfirm = async () => {
    if (!dataset) return;
    if (!displayName.trim()) {
      message.warning('请填写数据集名称');
      return;
    }
    if (allSkipped) {
      message.warning('至少保留一列入库');
      return;
    }
    if (!projectId) {
      message.warning('请选择项目（个人工作区也是一个项目）');
      return;
    }
    setConfirming(true);
    try {
      const updated = await datasetService.confirm(dataset.id, {
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        projectId,
        columns: columns.map((c) => ({
          name: c.name,
          originalName: c.originalName,
          type: c.type,
          description: c.description,
          skipped: c.skipped,
        })),
      });
      message.success('数据集已开始入库，请稍候');
      onDone(updated);
      onClose();
    } catch (err: any) {
      message.error(
        `提交失败：${err.response?.data?.message || err.message || '未知错误'}`,
      );
    } finally {
      setConfirming(false);
    }
  };

  // 当前选中的 project + 成员预览
  const selectedProject = projects.find((p) => p.id === projectId);
  const memberCount = selectedProject?.memberCount || 0;

  // === 渲染 ===
  return (
    <Modal
      open={open}
      title={
        <Space>
          <CloudUploadOutlined />
          上传数据集
        </Space>
      }
      width={920}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      maskClosable={false}
    >
      <Steps
        current={stage}
        items={[
          { title: '上传文件', icon: <InboxOutlined /> },
          { title: '确认表结构', icon: <EditOutlined /> },
          { title: '归属与权限', icon: <CheckCircleOutlined /> },
        ]}
        style={{ marginBottom: 24 }}
      />

      {/* Stage 0 — 上传 */}
      {stage === 0 && (
        <div>
          <Dragger {...uploadProps} disabled={uploading} style={{ padding: 24 }}>
            <p className="ant-upload-drag-icon">
              {uploading ? <LoadingOutlined /> : <InboxOutlined />}
            </p>
            <p className="ant-upload-text" style={{ fontSize: 16 }}>
              {uploading ? '正在解析…' : '点击或拖拽文件到这里'}
            </p>
            <p className="ant-upload-hint">
              支持 CSV / Excel (.xlsx / .xls)，单文件最大 50MB
            </p>
            {uploading && (
              <Progress percent={uploadPct} style={{ marginTop: 12 }} />
            )}
          </Dragger>

          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="数据安全"
            description={
              <div style={{ fontSize: 12 }}>
                上传后，数据集默认<b>仅自己可见</b>。下一步可以选择共享给某个项目（成员都能查询）。
                AI 分析对话会被严格限制只能查询你授权的数据集，无法读取他人数据。
              </div>
            }
          />
        </div>
      )}

      {/* Stage 1 — 编辑 schema */}
      {stage === 1 && dataset && (
        <div>
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            message={`已识别 ${columns.length} 列、${dataset.rowCount} 行`}
            description="请检查列名、类型、并为每列写一句业务描述（强烈推荐：能让 AI 准确理解你的数据）。"
          />

          <Input
            placeholder="数据集名称（必填）"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            prefix={<EditOutlined style={{ color: '#999' }} />}
            style={{ marginBottom: 8 }}
            maxLength={255}
          />
          <Input.TextArea
            placeholder="数据集整体描述（可选，但有助于 AI 理解，如『2024 年 Q1 客户订单流水，来自销售部门』）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            style={{ marginBottom: 16 }}
          />

          <div
            style={{
              maxHeight: 380,
              overflowY: 'auto',
              border: '1px solid #f0f0f0',
              borderRadius: 6,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead
                style={{
                  position: 'sticky',
                  top: 0,
                  background: '#fafafa',
                  borderBottom: '1px solid #f0f0f0',
                  zIndex: 1,
                }}
              >
                <tr>
                  <th style={th}>入库</th>
                  <th style={th}>列名</th>
                  <th style={th}>类型</th>
                  <th style={th}>业务描述</th>
                  <th style={th}>预览</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={td}>
                      <Radio
                        checked={!col.skipped}
                        onChange={() => updateColumn(idx, { skipped: !col.skipped })}
                      />
                    </td>
                    <td style={td}>
                      <Input
                        size="small"
                        value={col.name}
                        onChange={(e) =>
                          updateColumn(idx, {
                            name: e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, '_'),
                          })
                        }
                        style={{ width: 140 }}
                        disabled={col.skipped}
                      />
                      {col.originalName && (
                        <Tooltip title={`原列名：${col.originalName}`}>
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                            ⓘ
                          </Text>
                        </Tooltip>
                      )}
                    </td>
                    <td style={td}>
                      <Select
                        size="small"
                        value={col.type}
                        onChange={(v) => updateColumn(idx, { type: v })}
                        disabled={col.skipped}
                        style={{ width: 90 }}
                        options={TYPE_OPTIONS.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                      />
                    </td>
                    <td style={td}>
                      <Input
                        size="small"
                        placeholder="给 AI 看的描述..."
                        value={col.description || ''}
                        onChange={(e) =>
                          updateColumn(idx, { description: e.target.value })
                        }
                        disabled={col.skipped}
                        maxLength={500}
                      />
                    </td>
                    <td style={{ ...td, color: '#888', fontFamily: 'monospace', fontSize: 11 }}>
                      <Tooltip
                        title={
                          col.sample && col.sample.length > 0
                            ? (col.sample as any[]).slice(0, 5).join(', ')
                            : '(空)'
                        }
                      >
                        <span>
                          {col.sample && col.sample.length > 0
                            ? String(col.sample[0]).substring(0, 18)
                            : '—'}
                        </span>
                      </Tooltip>
                      {typeof col.nullRatio === 'number' && col.nullRatio > 0.1 && (
                        <Tag
                          color="orange"
                          style={{ marginLeft: 6, fontSize: 10, padding: '0 4px' }}
                        >
                          空 {Math.round(col.nullRatio * 100)}%
                        </Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allSkipped && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message="所有列被跳过 — 至少保留 1 列"
            />
          )}

          <Space style={{ marginTop: 16, width: '100%', justifyContent: 'space-between' }}>
            <Button onClick={() => setStage(0)}>上一步</Button>
            <Button type="primary" onClick={() => setStage(2)} disabled={allSkipped}>
              下一步：归属与权限
            </Button>
          </Space>
        </div>
      )}

      {/* Stage 2 — 项目归属（dataset 必属某个项目）*/}
      {stage === 2 && dataset && (
        <div>
          <Text strong>选择项目（Project Knowledge）</Text>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
            数据集必须归属于一个项目，同一项目下的所有数据集可在对话中一起使用（自动 JOIN）。
          </Paragraph>
          <Select
            placeholder="选择项目"
            value={projectId || undefined}
            onChange={setProjectId}
            style={{ width: '100%', marginBottom: 16 }}
            size="large"
            options={projects.map((p) => {
              const isWs = (p as any).isPersonalWorkspace;
              return {
                value: p.id,
                label: (
                  <Space>
                    {isWs ? <UserOutlined /> : <TeamOutlined />}
                    <span>{p.name}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {isWs ? '仅自己' : `${p.memberCount} 位成员`}
                    </Text>
                  </Space>
                ),
              };
            })}
          />

          {selectedProject && (selectedProject as any).isPersonalWorkspace ? (
            <Alert
              type="info"
              showIcon
              icon={<UserOutlined />}
              message="个人工作区"
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  只有你能在 Chat 里访问这份数据。后续可以转移到其他项目共享给团队。
                </Text>
              }
              style={{ marginBottom: 16 }}
            />
          ) : selectedProject ? (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message={
                <span>
                  共享给项目
                  <Tag color="gold" style={{ marginLeft: 8 }}>
                    {selectedProject.name}
                  </Tag>
                  — <b>{memberCount}</b> 位成员都将能在 Chat 中查询和导出这份数据
                </span>
              }
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共享后随时可在数据集详情页转移到其他项目
                </Text>
              }
              style={{ marginBottom: 16 }}
            />
          ) : null}

          <Alert
            type="info"
            message={
              <Space>
                <EyeOutlined />
                <span>
                  数据将存入 <code>user_data</code> schema，对话时严格受白名单限制，
                  无法被项目外用户访问
                </span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          />

          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button onClick={() => setStage(1)}>上一步</Button>
            <Button
              type="primary"
              loading={confirming}
              onClick={handleConfirm}
              disabled={!projectId}
              icon={<CheckCircleOutlined />}
            >
              确认并入库
            </Button>
          </Space>
        </div>
      )}
    </Modal>
  );
};

// 表格样式
const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 500,
  fontSize: 12,
  color: '#666',
};
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
