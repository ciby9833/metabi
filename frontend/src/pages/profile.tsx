import React, { useEffect, useState } from 'react';
import {
  App,
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CrownOutlined,
  GoogleOutlined,
  LockOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { authService, MeResponse, OAuthBinding, Providers } from '@/services';
import { MemoryCard } from '@/components/profile/MemoryCard';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

export default function ProfilePage() {
  const { message } = App.useApp();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [bindings, setBindings] = useState<OAuthBinding[]>([]);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const load = async () => {
    const [meData, bindingsData, providersData] = await Promise.all([
      authService.me(),
      authService.listBindings().catch(() => []),
      authService.getProviders().catch(() => null),
    ]);
    setMe(meData);
    setBindings(bindingsData);
    setProviders(providersData);
    profileForm.setFieldsValue({
      name: meData.name,
      avatarUrl: meData.avatarUrl || '',
      department: meData.department || '',
      jobRole: meData.jobRole || '',
    });
  };

  useEffect(() => {
    void load().catch((e) => message.error(`加载失败: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSaveProfile = async () => {
    try {
      await profileForm.validateFields();
    } catch {
      return;
    }
    setSavingProfile(true);
    try {
      const v = profileForm.getFieldsValue();
      await authService.updateProfile({
        name: v.name,
        avatarUrl: v.avatarUrl || undefined,
        department: v.department ?? undefined,
        jobRole: v.jobRole ?? undefined,
      });
      message.success('已更新');
      await load();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async () => {
    try {
      await passwordForm.validateFields();
    } catch {
      return;
    }
    setSavingPassword(true);
    try {
      const v = passwordForm.getFieldsValue();
      await authService.changePassword(v.oldPassword, v.newPassword);
      message.success('密码已更新');
      passwordForm.resetFields();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const onBind = async (provider: 'google' | 'feishu') => {
    try {
      const url = await authService.getOAuthAuthorizeUrl(provider);
      window.location.href = url;
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const onUnbind = async (provider: 'google' | 'feishu') => {
    try {
      await authService.unbind(provider);
      message.success('已解绑');
      await load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  if (!me) return null;

  const boundProviders = new Set(bindings.map((b) => b.provider));

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Card style={{ marginBottom: 16 }}>
        <Space size={20} align="start">
          <Avatar
            size={72}
            src={me.avatarUrl || undefined}
            icon={!me.avatarUrl && <UserOutlined />}
            style={{ backgroundColor: '#1677ff' }}
          />
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {me.name} {me.isAdmin && <Tag color="orange" icon={<CrownOutlined />}>系统管理员</Tag>}
            </Title>
            <Text type="secondary">{me.email}</Text>
            <div style={{ marginTop: 8 }}>
              <Tag color={me.emailVerified ? 'green' : 'default'}>
                {me.emailVerified ? '邮箱已验证' : '邮箱未验证'}
              </Tag>
              {me.lastLoginAt && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  上次登录 {dayjs(me.lastLoginAt).format('YYYY-MM-DD HH:mm')}
                </Text>
              )}
            </div>
          </div>
        </Space>
      </Card>

      <Card title="基本资料" style={{ marginBottom: 16 }}>
        <Form form={profileForm} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="avatarUrl" label="头像 URL（可选）">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item
            name="department"
            label="部门"
            tooltip="如「财务部」/「销售运营」— AI 对话时会用作软上下文，让回答更贴合你的关注"
          >
            <Input placeholder="如：财务部 / 销售运营 / 客户服务（可选）" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="jobRole"
            label="职能角色"
            tooltip="如「分析师」/「经理」— AI 会用合适的术语和详略度"
          >
            <Input placeholder="如：数据分析师 / 业务经理 / 总监（可选）" maxLength={100} />
          </Form.Item>
          <Button type="primary" onClick={onSaveProfile} loading={savingProfile}>
            保存
          </Button>
        </Form>
      </Card>

      <Card title={`修改密码${!me.hasPassword ? '（首次设置）' : ''}`} style={{ marginBottom: 16 }}>
        <Form form={passwordForm} layout="vertical">
          {me.hasPassword && (
            <Form.Item name="oldPassword" label="原密码" rules={[{ required: true }]}>
              <Input.Password prefix={<LockOutlined />} />
            </Form.Item>
          )}
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '至少 8 位' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位" />
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
                  return Promise.reject(new Error('两次输入不一致'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Button type="primary" onClick={onChangePassword} loading={savingPassword}>
            更新密码
          </Button>
        </Form>
      </Card>

      <MemoryCard />

      <Card title="第三方账号绑定">
        <Descriptions column={1} bordered size="small">
          {providers?.google && (
            <Descriptions.Item label={<><GoogleOutlined /> Google</>}>
              {boundProviders.has('google') ? (
                <Space>
                  <Tag color="green">已绑定</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {bindings.find((b) => b.provider === 'google')?.providerEmail}
                  </Text>
                  <Popconfirm title="解绑后将不能用 Google 登录此账号" onConfirm={() => onUnbind('google')}>
                    <Button size="small" danger>解绑</Button>
                  </Popconfirm>
                </Space>
              ) : (
                <Button size="small" onClick={() => onBind('google')}>绑定</Button>
              )}
            </Descriptions.Item>
          )}
          {providers?.feishu && (
            <Descriptions.Item label="飞书">
              {boundProviders.has('feishu') ? (
                <Space>
                  <Tag color="green">已绑定</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {bindings.find((b) => b.provider === 'feishu')?.providerEmail}
                  </Text>
                  <Popconfirm title="解绑后将不能用飞书登录此账号" onConfirm={() => onUnbind('feishu')}>
                    <Button size="small" danger>解绑</Button>
                  </Popconfirm>
                </Space>
              ) : (
                <Button size="small" onClick={() => onBind('feishu')}>绑定</Button>
              )}
            </Descriptions.Item>
          )}
          {!providers?.google && !providers?.feishu && (
            <Descriptions.Item label="说明">
              <Text type="secondary">服务端未配置任何第三方登录</Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    </div>
  );
}
