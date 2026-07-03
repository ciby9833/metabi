import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { App, Button, Tooltip } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import 'highlight.js/styles/github.css';

interface Props {
  content: string;
}

/**
 * Markdown 消息内容渲染
 *
 * 支持：加粗/斜体/表格/列表/代码块+高亮/引用/链接
 * code 块加复制按钮；表格 responsive；链接新窗口打开
 */
export const MarkdownContent: React.FC<Props> = ({ content }) => {
  const { message } = App.useApp();
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制');
  };

  return (
    <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.7 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // code 块加复制按钮；行内 code 保持原样
          pre({ node, children, ...props }) {
            const codeChild = React.Children.toArray(children).find(
              (c: any) => c?.type === 'code',
            ) as any;
            const codeText = codeChild?.props?.children?.toString?.() || '';
            return (
              <div style={{ position: 'relative', margin: '8px 0' }}>
                <pre
                  {...props}
                  style={{
                    background: '#f6f8fa',
                    padding: '10px 12px',
                    borderRadius: 6,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.5,
                    border: '1px solid #eaecef',
                  }}
                >
                  {children}
                </pre>
                <Tooltip title="复制代码">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    style={{ position: 'absolute', top: 4, right: 4 }}
                    onClick={() => copy(codeText.trim())}
                  />
                </Tooltip>
              </div>
            );
          },
          code({ node, className, children, ...props }: any) {
            const isBlock = className?.includes('language-');
            if (isBlock) return <code className={className} {...props}>{children}</code>;
            return (
              <code
                style={{
                  background: '#f6f8fa',
                  padding: '1px 5px',
                  borderRadius: 3,
                  fontSize: 12,
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          table({ children }) {
            return (
              <div style={{ overflowX: 'auto', margin: '8px 0' }}>
                <table
                  style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    fontSize: 12,
                  }}
                >
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th
                style={{
                  border: '1px solid #d0d7de',
                  padding: '4px 8px',
                  background: '#f6f8fa',
                  textAlign: 'left',
                  fontWeight: 600,
                }}
              >
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td style={{ border: '1px solid #d0d7de', padding: '4px 8px' }}>
                {children}
              </td>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#0969da' }}>
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote
                style={{
                  borderLeft: '3px solid #d0d7de',
                  paddingLeft: 10,
                  color: '#57606a',
                  margin: '8px 0',
                }}
              >
                {children}
              </blockquote>
            );
          },
          h1: ({ children }) => <h4 style={{ margin: '10px 0 4px', fontWeight: 600 }}>{children}</h4>,
          h2: ({ children }) => <h5 style={{ margin: '10px 0 4px', fontWeight: 600 }}>{children}</h5>,
          h3: ({ children }) => <h6 style={{ margin: '8px 0 4px', fontWeight: 600 }}>{children}</h6>,
          ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: '4px 0' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: 20, margin: '4px 0' }}>{children}</ol>,
          p: ({ children }) => <p style={{ margin: '4px 0' }}>{children}</p>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
