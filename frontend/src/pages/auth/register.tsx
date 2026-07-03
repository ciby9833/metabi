import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { App, Alert, Button, Form, Input, Space } from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { authService, Providers } from '@/services';

export default function RegisterPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    void authService.getProviders().then(setProviders);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendCode = async () => {
    try {
      await form.validateFields(['email']);
    } catch {
      return;
    }
    const email = form.getFieldValue('email');
    setSending(true);
    try {
      const r = await authService.sendEmailCode(email, 'register');
      message.success('验证码已发送，请查收邮箱');
      setCooldown(60);
      if (r.devCode) setDevCode(r.devCode);
    } catch (err: any) {
      message.error(err.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  const onSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const v = form.getFieldsValue();
    setLoading(true);
    try {
      await authService.register({ email: v.email, password: v.password, name: v.name, code: v.code });
      message.success('注册成功');
      void router.replace('/chat');
    } catch (err: any) {
      message.error(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  if (providers && !providers.register) {
    return (
      <AuthLayout title="注册已关闭" subtitle="请联系管理员开通账号">
        <Link href="/auth/login">返回登录</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="注册新账号" subtitle="3 步搞定">
      {devCode && (
        <Alert
          type="info"
          showIcon
          message={
            <span>
              开发模式（未配置真实邮箱服务）：验证码 <strong>{devCode}</strong>
            </span>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical" onFinish={onSubmit}>
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
        {providers?.requireEmailCode && (
          <Form.Item
            name="code"
            label="邮箱验证码"
            rules={[
              { required: true, message: '请输入验证码' },
              { pattern: /^\d{6}$/, message: '验证码应为 6 位数字' },
            ]}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input size="large" placeholder="6 位数字" maxLength={6} />
              <Button size="large" onClick={sendCode} loading={sending} disabled={cooldown > 0}>
                {cooldown > 0 ? `${cooldown}s 后重试` : '发送验证码'}
              </Button>
            </Space.Compact>
          </Form.Item>
        )}
        <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请填写姓名' }]}>
          <Input prefix={<UserOutlined />} size="large" placeholder="昵称或姓名" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 8, message: '密码至少 8 位' },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} size="large" placeholder="至少 8 位" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认密码"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} size="large" placeholder="再输一次" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          注册并登录
        </Button>
      </Form>
      <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13 }}>
        <Link href="/auth/login">已有账号？返回登录</Link>
      </div>
    </AuthLayout>
  );
}

RegisterPage.disableLayout = true;
