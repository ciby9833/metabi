import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { App, Spin, Typography } from 'antd';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { authService } from '@/services';

const { Text } = Typography;

export default function OAuthCallbackPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    const provider = router.query.provider as string;
    const code = router.query.code as string | undefined;
    const errParam = router.query.error as string | undefined;

    if (errParam) {
      setError(`第三方授权失败: ${errParam}`);
      return;
    }
    if (!code) {
      setError('未拿到 code 参数');
      return;
    }
    if (provider !== 'google' && provider !== 'feishu') {
      setError(`不支持的 provider: ${provider}`);
      return;
    }

    (async () => {
      try {
        await authService.handleOAuthCallback(provider, code);
        message.success('登录成功');
        void router.replace('/chat');
      } catch (err: any) {
        setError(err.message || '登录失败');
      }
    })();
  }, [router, message]);

  return (
    <AuthLayout title="第三方登录" subtitle="处理中…">
      {error ? (
        <div>
          <Text type="danger">{error}</Text>
          <div style={{ marginTop: 16 }}>
            <Link href="/auth/login">返回登录页</Link>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip="正在完成登录…" size="large" />
        </div>
      )}
    </AuthLayout>
  );
}

OAuthCallbackPage.disableLayout = true;
