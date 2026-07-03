import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Alert, App, Button, Form, Input, Steps } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { authService } from '@/services';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

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
    setSending(true);
    try {
      const r = await authService.forgotPassword(form.getFieldValue('email'));
      message.success('如果邮箱已注册，验证码已发送');
      setCooldown(60);
      if (r.devCode) setDevCode(r.devCode);
      setStep(1);
    } catch (err: any) {
      message.error(err.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  const onReset = async () => {
    try {
      await form.validateFields(['code', 'newPassword', 'confirm']);
    } catch {
      return;
    }
    const v = form.getFieldsValue();
    setLoading(true);
    try {
      await authService.resetPassword(v.email, v.code, v.newPassword);
      message.success('密码已重置，请用新密码登录');
      void router.replace('/auth/login');
    } catch (err: any) {
      message.error(err.message || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="找回密码" subtitle="通过邮箱验证码重置">
      <Steps current={step} size="small" style={{ marginBottom: 20 }}
        items={[{ title: '验证邮箱' }, { title: '设新密码' }]}
      />
      {devCode && step === 1 && (
        <Alert
          type="info"
          showIcon
          message={
            <span>
              开发模式：验证码 <strong>{devCode}</strong>
            </span>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input prefix={<MailOutlined />} size="large" placeholder="you@example.com" disabled={step === 1} />
        </Form.Item>

        {step === 0 && (
          <Button type="primary" block size="large" onClick={sendCode} loading={sending} disabled={cooldown > 0}>
            {cooldown > 0 ? `${cooldown}s 后重试` : '发送验证码'}
          </Button>
        )}

        {step === 1 && (
          <>
            <Form.Item
              name="code"
              label="验证码"
              rules={[
                { required: true, message: '请输入验证码' },
                { pattern: /^\d{6}$/, message: '验证码应为 6 位数字' },
              ]}
            >
              <Input size="large" placeholder="6 位数字" maxLength={6} />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '至少 8 位' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} size="large" placeholder="至少 8 位" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} size="large" placeholder="再输一次" />
            </Form.Item>
            <Button type="primary" block size="large" onClick={onReset} loading={loading}>
              重置密码
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => setStep(0)}>
              重新发送验证码
            </Button>
          </>
        )}
      </Form>
      <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
        <Link href="/auth/login">返回登录</Link>
      </div>
    </AuthLayout>
  );
}

ForgotPasswordPage.disableLayout = true;
