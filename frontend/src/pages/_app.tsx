import { useEffect } from 'react';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import '@/styles/globals.css';
import { AppLayout } from '@/components/layout/AppLayout';
import { authStorage } from '@/lib/auth-storage';

type PageWithFlags = { disableLayout?: boolean };

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const PageComp = Component as React.ComponentType & PageWithFlags;
  const isAuthPage = router.pathname.startsWith('/auth/');

  // 全局路由守卫：未登录访问受保护页面 → 跳登录
  useEffect(() => {
    if (isAuthPage) return;
    if (!authStorage.isAuthenticated()) {
      const next = encodeURIComponent(router.asPath);
      void router.replace(`/auth/login?next=${next}`);
    }
  }, [router, isAuthPage]);

  const content =
    isAuthPage || PageComp.disableLayout ? (
      <Component {...pageProps} />
    ) : (
      <AppLayout>
        <Component {...pageProps} />
      </AppLayout>
    );

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>{content}</AntdApp>
    </ConfigProvider>
  );
}
