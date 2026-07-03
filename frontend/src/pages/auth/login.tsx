import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { App, Button, Divider, Form, Input, Space } from 'antd';
import { GoogleOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { authService, Providers } from '@/services';

export default function LoginPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    void authService
      .getProviders()
      .then(setProviders)
      .catch((e) => {
        message.error(`检测登录方式失败: ${e.message}`);
      });
  }, [message]);

  const onLogin = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const { email, password } = form.getFieldsValue();
    setLoading(true);
    try {
      await authService.login(email, password);
      message.success('登录成功');
      const next = (router.query.next as string) || '/chat';
      void router.replace(next);
    } catch (err: any) {
      message.error(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const onOAuth = async (provider: 'google' | 'feishu') => {
    try {
      const url = await authService.getOAuthAuthorizeUrl(provider);
      window.location.href = url;
    } catch (err: any) {
      message.error(err.message);
    }
  };

  return (
    <AuthLayout title="登录" subtitle="欢迎回来">
      <Form form={form} layout="vertical" onFinish={onLogin}>
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input prefix={<MailOutlined />} size="large" placeholder="you@example.com" autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} size="large" placeholder="密码" autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          登录
        </Button>
      </Form>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <Link href="/auth/forgot-password">忘记密码？</Link>
        {providers?.register && <Link href="/auth/register">注册账号</Link>}
      </div>

      {(providers?.google || providers?.feishu) && (
        <>
          <Divider style={{ marginBlock: 20 }} plain>
            <span style={{ color: '#8f959e', fontSize: 12 }}>或第三方登录</span>
          </Divider>
          <Space style={{ width: '100%' }} direction="vertical">
            {providers?.google && (
              <Button block size="large" icon={<GoogleOutlined />} onClick={() => onOAuth('google')}>
                Google 登录
              </Button>
            )}
            {providers?.feishu && (
              <Button block size="large" onClick={() => onOAuth('feishu')}>
                飞书登录
              </Button>
            )}
          </Space>
        </>
      )}
    </AuthLayout>
  );
}

LoginPage.disableLayout = true;
