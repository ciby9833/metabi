/**
 * AnalyzedScopeBar — 企业模式「分析范围」选择器（傻瓜式引导）
 *
 * 三态设计：
 *   1. 未选表 → 蓝色 hint 条 "💡 选几张表让 AI 更快回答" + 大【+ 选表】按钮
 *   2. 已选表 → 绿色 chip 条列出已选（可 X 删除） + 小【改】按钮
 *   3. 弹出 Modal → 搜索 + 全部表清单 checkbox 多选
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  tables: string[];         // 可选的全部表
  selected: string[];       // 已选表
  onChange: (next: string[]) => void;
  disabled?: boolean;       // 数据源未选或加载中
  loading?: boolean;
}

export const AnalyzedScopeBar: React.FC<Props> = ({
  tables,
  selected,
  onChange,
  disabled,
  loading,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>([]);

  const openPicker = () => {
    setDraft(selected);
    setSearch('');
    setPickerOpen(true);
  };

  const confirmPicker = () => {
    onChange(draft);
    setPickerOpen(false);
  };

  const filteredTables = useMemo(() => {
    if (!search) return tables;
    const s = search.toLowerCase();
    return tables.filter((t) => t.toLowerCase().includes(s));
  }, [tables, search]);

  const toggleDraft = (t: string) => {
    setDraft((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const removeChip = (t: string) => {
    onChange(selected.filter((x) => x !== t));
  };

  if (disabled) return null;

  return (
    <div style={{ padding: '8px 24px' }}>
      {selected.length === 0 ? (
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message={
            <Space size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text>
                💡 <b>选几张表</b>让 AI 直接聚焦，省时省 token
                <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                  （可选；不选也能用，AI 会自己找）
                </Text>
              </Text>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={openPicker}
                loading={loading}
              >
                选表（{tables.length} 张可用）
              </Button>
            </Space>
          }
          style={{ padding: '6px 12px' }}
        />
      ) : (
        <div
          style={{
            padding: '8px 12px',
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
          <Text strong style={{ fontSize: 12 }}>
            分析范围（{selected.length}）：
          </Text>
          {selected.map((t) => (
            <Tag
              key={t}
              closable
              onClose={() => removeChip(t)}
              color="green"
              style={{ margin: 0 }}
            >
              {t}
            </Tag>
          ))}
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={openPicker}
            style={{ marginLeft: 'auto', padding: 0 }}
          >
            改
          </Button>
        </div>
      )}

      <Modal
        open={pickerOpen}
        title={
          <Space>
            <PlusOutlined />
            选择要分析的表
            <Tag color="blue">{draft.length} 已选</Tag>
          </Space>
        }
        onCancel={() => setPickerOpen(false)}
        onOk={confirmPicker}
        okText={`确认（${draft.length} 张）`}
        cancelText="取消"
        width={640}
      >
        <Alert
          type="info"
          showIcon
          message="提示"
          description="选中的表会作为 AI 的分析范围 — 输入框里输 @ 就能联想这些表的字段"
          style={{ marginBottom: 12 }}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={`搜索表名（如 ${tables[0]?.split('.').pop() || 'orders'}）`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <div
          style={{
            maxHeight: 400,
            overflowY: 'auto',
            border: '1px solid #f0f0f0',
            borderRadius: 6,
            padding: 8,
          }}
        >
          {filteredTables.length === 0 ? (
            <Empty description="无匹配表" />
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {filteredTables.map((t) => (
                <Checkbox
                  key={t}
                  checked={draft.includes(t)}
                  onChange={() => toggleDraft(t)}
                  style={{ padding: '4px 8px', width: '100%' }}
                >
                  <code style={{ background: '#f5f5f5', padding: '0 6px' }}>{t}</code>
                </Checkbox>
              ))}
            </Space>
          )}
        </div>
      </Modal>
    </div>
  );
};
