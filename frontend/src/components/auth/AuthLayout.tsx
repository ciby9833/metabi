import React from 'react';
import { Card, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface Props {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}

export const AuthLayout: React.FC<Props> = ({ title, subtitle, children }) => {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #f5f7fa 0%, #e8eef7 100%)',
        padding: '24px 16px',
      }}
    >
      <Card style={{ width: 420, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <RobotOutlined style={{ fontSize: 36, color: '#1677ff' }} />
          <Title level={3} style={{ marginTop: 8, marginBottom: 4 }}>
            ChatBI
          </Title>
          <div style={{ color: '#646a73', fontSize: 13 }}>智能数据分析对话平台</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle && (
            <div style={{ color: '#8f959e', fontSize: 13, marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
        {children}
      </Card>
    </div>
  );
};
