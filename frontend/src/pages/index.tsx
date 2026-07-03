import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Spin } from 'antd';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    void router.replace('/chat');
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: 'calc(100vh - 64px)',
      }}
    >
      <Spin tip="正在跳转到对话页..." size="large" />
    </div>
  );
}
