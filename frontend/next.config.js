/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // antd v5 + rc-util 在 Node 24 ESM 严格解析下需要通过 Next.js 转译
  transpilePackages: [
    'antd',
    '@ant-design/icons',
    '@ant-design/icons-svg',
    'rc-util',
    'rc-pagination',
    'rc-picker',
    'rc-notification',
    'rc-tooltip',
    'rc-table',
    'rc-tree',
    'rc-tree-select',
    'rc-cascader',
    'rc-checkbox',
    'rc-dropdown',
    'rc-field-form',
    'rc-image',
    'rc-input',
    'rc-input-number',
    'rc-mentions',
    'rc-menu',
    'rc-motion',
    'rc-overflow',
    'rc-progress',
    'rc-rate',
    'rc-resize-observer',
    'rc-segmented',
    'rc-select',
    'rc-slider',
    'rc-steps',
    'rc-switch',
    'rc-textarea',
    'rc-tabs',
    'rc-upload',
    'rc-dialog',
    'rc-drawer',
    'rc-collapse',
    'rc-virtual-list',
    'echarts-for-react',
  ],

  async rewrites() {
    const backendUrl = process.env.BACKEND_PROXY_URL;
    if (!backendUrl) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
