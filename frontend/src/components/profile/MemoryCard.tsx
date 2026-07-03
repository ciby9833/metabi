/**
 * MemoryCard — Settings 页的 Memory 板块
 *
 * 三块：
 *   - Style：用户主动选（强约束）— 详略、数字格式、语言、图表偏好
 *   - Content：Refiner 学习（弱约束）— 用户可看 + 编辑 + 清空
 *   - 透明 + 一键 reset（anti-bias 关键设计）
 */
import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Alert,
} from 'antd';
import {
  BulbOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { profileService, ProfileResponse } from '@/services';

const { Title, Text, Paragraph } = Typography;

export const MemoryCard: React.FC = () => {
  const { message, modal } = App.useApp();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [savingStyle, setSavingStyle] = useState(false);
  const [refining, setRefining] = useState(false);
  const [styleForm] = Form.useForm();
  const [contentForm] = Form.useForm();

  const load = async () => {
    try {
      const p = await profileService.get();
      setProfile(p);
      styleForm.setFieldsValue({
        verbosity: p.styleMemory.verbosity || 'normal',
        numberFormat: p.styleMemory.numberFormat || 'auto',
        preferredLanguage: p.styleMemory.preferredLanguage || 'auto',
        preferredChartType: p.styleMemory.preferredChartType || 'auto',
      });
      contentForm.setFieldsValue({
        oneLinerSummary: p.contentMemory.oneLinerSummary || '',
        interestTopics: (p.contentMemory.interestTopics || []).join('、'),
        knownTerms: (p.contentMemory.knownTerms || []).join('、'),
        defaultDateRange: p.contentMemory.defaultDateRange || '',
      });
    } catch (err: any) {
      message.error(`加载 Memory 失败：${err.message || err}`);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveStyle = async () => {
    setSavingStyle(true);
    try {
      const v = styleForm.getFieldsValue();
      await profileService.patchStyle(v);
      message.success('风格偏好已保存');
      await load();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSavingStyle(false);
    }
  };

  const saveContent = async () => {
    try {
      const v = contentForm.getFieldsValue();
      await profileService.patchContent({
        oneLinerSummary: v.oneLinerSummary || undefined,
        interestTopics: (v.interestTopics || '')
          .split(/[、,，\s]+/)
          .filter(Boolean)
          .slice(0, 5),
        knownTerms: (v.knownTerms || '')
          .split(/[、,，\s]+/)
          .filter(Boolean)
          .slice(0, 20),
        defaultDateRange: v.defaultDateRange || undefined,
      });
      message.success('关注信息已保存');
      await load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const runRefine = async () => {
    setRefining(true);
    try {
      await profileService.refineNow();
      message.success('已基于最近对话更新');
      await load();
    } catch (err: any) {
      message.error(`刷新失败：${err.response?.data?.message || err.message}`);
    } finally {
      setRefining(false);
    }
  };

  const reset = () => {
    modal.confirm({
      title: '清空 Memory？',
      icon: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>将清空 AI 学到的所有偏好和你设置的风格选项。</p>
          <Text type="warning">⚠️ 下次对话 AI 会回到默认行为</Text>
        </div>
      ),
      okText: '清空',
      okType: 'danger',
      onOk: async () => {
        try {
          await profileService.reset();
          message.success('已清空');
          await load();
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  if (!profile) return null;

  return (
    <Card
      title={
        <Space>
          <BulbOutlined />
          <span>AI Memory（你的偏好与画像）</span>
          <Tooltip title="AI 会根据你的偏好调整回答风格。这是 soft prior — 不会让 AI 回避指出问题。">
            <Tag color="blue">soft prior</Tag>
          </Tooltip>
        </Space>
      }
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Tooltip title="基于最近的对话立刻让 AI 重新学习你的偏好">
            <Button
              icon={<SyncOutlined spin={refining} />}
              loading={refining}
              onClick={runRefine}
            >
              立刻分析我
            </Button>
          </Tooltip>
          <Popconfirm
            title="确定清空 Memory？"
            onConfirm={reset}
            okText="清空"
            cancelText="取消"
          >
            <Button icon={<DeleteOutlined />} danger>
              清空
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        message="透明可控"
        description="所有内容下方都展示给你 — 不对就改，不需要就清空。AI 不会用这些来回避负面发现。"
        style={{ marginBottom: 16 }}
        closable
      />

      <Title level={5}>风格偏好（你主动选）</Title>
      <Form form={styleForm} layout="vertical">
        <Space size="large" wrap>
          <Form.Item name="verbosity" label="详略" style={{ minWidth: 160 }}>
            <Select
              options={[
                { value: 'concise', label: '简洁（一句话+数字）' },
                { value: 'normal', label: '标准' },
                { value: 'detailed', label: '详尽（含统计/对比）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="numberFormat" label="数字格式" style={{ minWidth: 140 }}>
            <Select
              options={[
                { value: 'auto', label: 'AI 自决' },
                { value: 'absolute', label: '完整（123456）' },
                { value: 'kw', label: '万 单位（12.3 万）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="preferredLanguage" label="语言" style={{ minWidth: 140 }}>
            <Select
              options={[
                { value: 'auto', label: '跟随提问' },
                { value: 'zh-CN', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Form.Item>
          <Form.Item name="preferredChartType" label="图表偏好" style={{ minWidth: 140 }}>
            <Select
              options={[
                { value: 'auto', label: 'AI 自决' },
                { value: 'bar', label: '柱状' },
                { value: 'line', label: '折线' },
                { value: 'pie', label: '饼图' },
                { value: 'table', label: '表格' },
              ]}
            />
          </Form.Item>
        </Space>
        <Button type="primary" loading={savingStyle} onClick={saveStyle}>
          保存风格
        </Button>
      </Form>

      <div style={{ height: 24 }} />

      <Title level={5}>
        关注画像
        <Tag color="default" style={{ marginLeft: 8 }}>
          AI 自动学习 · 你也可以改
        </Tag>
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {profile.lastRefinedAt
          ? `上次刷新：${new Date(profile.lastRefinedAt).toLocaleString('zh-CN')} · 已分析 ${
              profile.refinedThroughConvCount
            } 次对话`
          : 'Refiner 还未跑过 — 多用几次对话后会自动学习'}
      </Paragraph>
      <Form form={contentForm} layout="vertical">
        <Form.Item
          name="oneLinerSummary"
          label="一句话画像"
          tooltip="不希望 AI 把你框死？写空即可"
        >
          <Input placeholder="如：财务团队，常做客户级别的应收分析" maxLength={200} />
        </Form.Item>
        <Form.Item
          name="interestTopics"
          label="常关注的主题（顿号 / 逗号分隔，最多 5 个）"
        >
          <Input placeholder="如：应收账款、DSO、客户分级" />
        </Form.Item>
        <Form.Item
          name="knownTerms"
          label="你已熟悉的术语（顿号分隔；AI 不会再解释这些）"
        >
          <Input placeholder="如：DSO、账期、客单价" />
        </Form.Item>
        <Form.Item name="defaultDateRange" label="默认时间窗口">
          <Input placeholder="如：最近 30 天 / 本月" maxLength={50} />
        </Form.Item>
        <Button onClick={saveContent}>保存关注</Button>
      </Form>
    </Card>
  );
};
