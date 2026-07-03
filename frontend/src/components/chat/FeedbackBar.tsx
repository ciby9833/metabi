import React, { useState } from 'react';
import { App, Button, Checkbox, Input, Modal, Space, Tooltip } from 'antd';
import {
  LikeOutlined,
  LikeFilled,
  DislikeOutlined,
  DislikeFilled,
  StarOutlined,
} from '@ant-design/icons';
import { chatService } from '@/services';

interface Props {
  messageId: string;
  /** assistant 消息是拒答时，禁用反馈（拒答没什么好赞/踩的）*/
  disabled?: boolean;
  /** 是否有 SQL（决定能否"沉淀模板"）*/
  hasSql?: boolean;
}

/**
 * 反馈条：赞 / 踩 / 沉淀为模板
 * 一条消息只允许提交一次（提交后 UI 切换为"已记录"）
 */
export const FeedbackBar: React.FC<Props> = ({ messageId, disabled, hasSql }) => {
  const { message: msg } = App.useApp();
  const [submitted, setSubmitted] = useState<'good' | 'bad' | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [badOpen, setBadOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitGood = async (saveAsTemplate: boolean) => {
    setSubmitting(true);
    try {
      await chatService.submitFeedback(messageId, {
        type: 'good',
        saveAsTemplate,
        templatePriority: saveAsTemplate ? 10 : undefined,
      });
      setSubmitted('good');
      if (saveAsTemplate) setSavedTemplate(true);
      msg.success(saveAsTemplate ? '已沉淀为推荐问题模板 ✨' : '感谢反馈');
    } catch (err) {
      msg.error(`提交失败: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitBad = async () => {
    setSubmitting(true);
    try {
      await chatService.submitFeedback(messageId, { type: 'bad', notes });
      setSubmitted('bad');
      setBadOpen(false);
      setNotes('');
      msg.success('已记录，工程师会复盘');
    } catch (err) {
      msg.error(`提交失败: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (disabled) return null;

  return (
    <>
      <Space size={4} style={{ marginTop: 4 }}>
        <Tooltip title="回答有用">
          <Button
            type="text"
            size="small"
            icon={submitted === 'good' ? <LikeFilled style={{ color: '#52c41a' }} /> : <LikeOutlined />}
            disabled={submitted !== null}
            loading={submitting && submitted === null}
            onClick={() => void submitGood(false)}
          />
        </Tooltip>
        <Tooltip title="回答有问题（会被工程师复盘）">
          <Button
            type="text"
            size="small"
            icon={submitted === 'bad' ? <DislikeFilled style={{ color: '#ff4d4f' }} /> : <DislikeOutlined />}
            disabled={submitted !== null}
            onClick={() => setBadOpen(true)}
          />
        </Tooltip>
        {hasSql && (
          <Tooltip title="这是个好答案 → 沉淀为推荐问题模板（其他用户可一键复用）">
            <Button
              type="text"
              size="small"
              icon={<StarOutlined style={{ color: savedTemplate ? '#faad14' : undefined }} />}
              disabled={submitted !== null}
              loading={submitting && submitted === null}
              onClick={() => void submitGood(true)}
            >
              {savedTemplate ? '已沉淀' : '沉淀模板'}
            </Button>
          </Tooltip>
        )}
      </Space>

      <Modal
        title="反馈：哪里出错了？"
        open={badOpen}
        onCancel={() => setBadOpen(false)}
        onOk={submitBad}
        confirmLoading={submitting}
        okText="提交"
        cancelText="取消"
      >
        <Input.TextArea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例：数据集对应错了 / SQL 字段名不对 / 时区算错了..."
        />
      </Modal>
    </>
  );
};
