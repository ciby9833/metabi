import React, { useEffect, useState } from 'react';
import { Layout, Menu, Typography } from 'antd';
import {
  MessageOutlined,
  DatabaseOutlined,
  ScheduleOutlined,
  BookOutlined,
  ProjectOutlined,
  CloudUploadOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { authStorage } from '@/lib/auth-storage';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { UserMenu } from './UserMenu';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

interface Props {
  children: React.ReactNode;
}

const navItems = [
  { key: '/chat', label: '对话', icon: <MessageOutlined />, href: '/chat' },
  { key: '/dashboards', label: '看板', icon: <DashboardOutlined />, href: '/dashboards' },
  { key: '/projects', label: '项目', icon: <ProjectOutlined />, href: '/projects' },
  { key: '/datasets', label: '我的数据', icon: <CloudUploadOutlined />, href: '/datasets' },
  { key: '/datasource', label: '数据源', icon: <DatabaseOutlined />, href: '/datasource' },
  { key: '/skills', label: 'Skills', icon: <BookOutlined />, href: '/skills' },
  { key: '/task', label: '定时任务', icon: <ScheduleOutlined />, href: '/task' },
];

export const AppLayout: React.FC<Props> = ({ children }) => {
  const router = useRouter();
  // ⚠️ authStorage 读 localStorage —— SSR 时不存在，会导致 hydration mismatch
  // 只在 client mount 后判定 admin，SSR 阶段一律用基础 navItems（跟客户端首次渲染保持一致）
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    setIsAdmin(!!authStorage.getUser()?.isAdmin);
  }, []);

  const items = isAdmin
    ? [
        ...navItems,
        {
          key: '/admin/evals',
          label: 'Eval Runs',
          icon: <DashboardOutlined />,
          href: '/admin/evals',
        },
      ]
    : navItems;
  const activeKey = items.find((item) => router.pathname.startsWith(item.key))?.key || '/chat';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#001529',
          padding: '0 24px',
        }}
      >
        <Title level={4} style={{ color: 'white', margin: 0 }}>
          🤖 ChatBI · 智能数据分析对话平台
        </Title>
        <UserMenu />
      </Header>
      <Layout>
        <Sider
          width={180}
          breakpoint="lg"
          style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}
        >
          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            style={{ height: '100%', borderRight: 0, paddingTop: 12 }}
            items={items.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: <Link href={item.href}>{item.label}</Link>,
            }))}
          />
        </Sider>
        <Content style={{ padding: 0, background: '#fff' }}>{children}</Content>
      </Layout>
    </Layout>
  );
};
