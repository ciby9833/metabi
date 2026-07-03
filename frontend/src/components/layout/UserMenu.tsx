import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { App, Avatar, Dropdown, Space, Typography } from 'antd';
import {
  LogoutOutlined,
  UserOutlined,
  CrownOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { authService } from '@/services';
import { authStorage, StoredUser } from '@/lib/auth-storage';

const { Text } = Typography;

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const { message } = App.useApp();
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    setUser(authStorage.getUser());
    // 异步 refresh 一下，确保是最新的
    void authService
      .me()
      .then((u) => setUser(u))
      .catch(() => undefined);
  }, []);

  const onLogout = async () => {
    await authService.logout();
    message.success('已退出');
    void router.replace('/auth/login');
  };

  if (!user) return null;

  const items = [
    {
      key: 'info',
      disabled: true,
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 600 }}>{user.name}</div>
          <div style={{ color: '#8f959e', fontSize: 12 }}>{user.email}</div>
          {user.isAdmin && (
            <div style={{ color: '#fa8c16', fontSize: 12, marginTop: 4 }}>
              <CrownOutlined /> 系统管理员
            </div>
          )}
        </div>
      ),
    },
    { type: 'divider' as const },
    {
      key: 'profile',
      icon: <SettingOutlined />,
      label: '个人设置',
      onClick: () => router.push('/profile'),
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: onLogout,
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
      <Space style={{ cursor: 'pointer', color: 'white' }}>
        <Avatar
          size={32}
          icon={!user.avatarUrl && <UserOutlined />}
          src={user.avatarUrl || undefined}
          style={{ backgroundColor: '#1677ff' }}
        />
        <Text style={{ color: 'white' }}>{user.name}</Text>
      </Space>
    </Dropdown>
  );
};
