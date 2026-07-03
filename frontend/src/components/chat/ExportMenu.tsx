import React, { useState } from 'react';
import { App, Button, Checkbox, Dropdown, Modal, Space, Spin, Typography } from 'antd';
import {
  DownloadOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileMarkdownOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface Props {
  messageId: string;
  /** 用于 PDF 截图的 DOM 节点（通常传 MessageBubble 内最外层 Card 的 ref.current）*/
  getCardElement?: () => HTMLElement | null;
  /** 文件名前缀，没传就用 messageId */
  filenamePrefix?: string;
}

type Format = 'csv' | 'excel' | 'markdown' | 'pdf';

export const ExportMenu: React.FC<Props> = ({ messageId, getCardElement, filenamePrefix }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<Format | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pendingFormat, setPendingFormat] = useState<Format | null>(null);
  const [stripLimit, setStripLimit] = useState(true);

  const dateStamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const triggerServerDownload = async (format: 'csv' | 'excel' | 'markdown') => {
    setLoading(format);
    try {
      const resp = await api.get(`/v1/chat/messages/${messageId}/export`, {
        params: { format, strip_limit: stripLimit ? 'true' : 'false' },
        responseType: 'blob',
        timeout: 180_000,
      });
      const cd = (resp.headers['content-disposition'] || '') as string;
      const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)["']?/i);
      const fallbackExt = format === 'excel' ? 'xlsx' : format === 'markdown' ? 'md' : 'csv';
      const fallbackName = `${filenamePrefix || 'chatbi'}_${dateStamp()}.${fallbackExt}`;
      const filename = m ? decodeURIComponent(m[1]) : fallbackName;

      const blob = new Blob([resp.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (err: any) {
      // axios 拿到 blob 失败时，把 blob 转回字符串看后端错误
      let detail = err?.message || '导出失败';
      if (err?.response?.data instanceof Blob) {
        try {
          const txt = await err.response.data.text();
          const parsed = JSON.parse(txt);
          detail = parsed.message || detail;
        } catch {
          // ignore
        }
      }
      message.error(`导出失败：${detail}`);
    } finally {
      setLoading(null);
    }
  };

  const triggerPdfDownload = async () => {
    const el = getCardElement?.();
    if (!el) {
      message.error('找不到要导出的内容，请刷新后再试');
      return;
    }
    setLoading('pdf');
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 10;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // 分页：超过 1 页就切片
      let heightLeft = imgHeight;
      let position = 5;
      pdf.addImage(imgData, 'PNG', 5, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - 10;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 5;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 5, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - 10;
      }
      pdf.save(`${filenamePrefix || 'chatbi'}_${dateStamp()}.pdf`);
      message.success('PDF 已下载');
    } catch (err: any) {
      message.error(`PDF 生成失败：${err?.message || err}`);
    } finally {
      setLoading(null);
    }
  };

  const handlePick = (key: Format) => {
    if (key === 'pdf') {
      // PDF 走前端截图，无 stripLimit 选项，直接走
      void triggerPdfDownload();
      return;
    }
    setPendingFormat(key);
    setOptionsOpen(true);
  };

  const confirmServerDownload = async () => {
    if (!pendingFormat || pendingFormat === 'pdf') return;
    setOptionsOpen(false);
    await triggerServerDownload(pendingFormat);
  };

  const items = [
    {
      key: 'csv',
      label: (
        <Space>
          <FileTextOutlined /> CSV（全量数据）
        </Space>
      ),
    },
    {
      key: 'excel',
      label: (
        <Space>
          <FileExcelOutlined /> Excel（含查询信息表）
        </Space>
      ),
    },
    {
      key: 'markdown',
      label: (
        <Space>
          <FileMarkdownOutlined /> Markdown 综合报告
        </Space>
      ),
    },
    {
      key: 'pdf',
      label: (
        <Space>
          <FilePdfOutlined /> PDF（当前消息整页截图）
        </Space>
      ),
    },
  ];

  return (
    <>
      <Dropdown
        menu={{ items, onClick: ({ key }) => handlePick(key as Format) }}
        trigger={['click']}
        disabled={!!loading}
      >
        <Button size="small" type="default" icon={<DownloadOutlined />}>
          {loading ? <Spin size="small" /> : '导出'} <DownOutlined />
        </Button>
      </Dropdown>

      <Modal
        title={`导出选项 — ${pendingFormat?.toUpperCase()}`}
        open={optionsOpen}
        onCancel={() => setOptionsOpen(false)}
        onOk={confirmServerDownload}
        okText="开始导出"
        cancelText="取消"
        confirmLoading={!!loading}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          导出会从消息原 SQL 重新执行一次拿真实数据（独立路径、不进 LLM），
          上限由服务端 <Text code>SQL_EXPORT_MAX_ROWS</Text> 控制（默认 100,000 行）。
        </Paragraph>
        <Checkbox checked={stripLimit} onChange={(e) => setStripLimit(e.target.checked)}>
          剥除 SQL 末尾的 <Text code>LIMIT N</Text>，拿真正的全量
        </Checkbox>
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          ✅ 推荐勾上。否则只会拿到当时为了页面展示而限定的少量行。
        </Paragraph>
      </Modal>
    </>
  );
};
