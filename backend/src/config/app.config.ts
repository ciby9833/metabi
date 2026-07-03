import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  name: process.env.APP_NAME || 'ChatBI',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  logLevel: process.env.LOG_LEVEL || 'debug',

  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret',
    expiresIn: process.env.JWT_EXPIRATION || '15m',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET || 'your_jwt_secret') + '_refresh',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d',
  },

  auth: {
    registrationEnabled: process.env.REGISTRATION_ENABLED !== 'false',
    requireEmailCode: process.env.REGISTRATION_REQUIRE_EMAIL_CODE !== 'false',
    allowedEmailDomains: (process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  mail: {
    enabled: process.env.MAIL_ENABLED === 'true',
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT || '465', 10),
    secure: process.env.MAIL_SECURE !== 'false',
    user: process.env.MAIL_USER,
    password: process.env.MAIL_PASSWORD,
    fromName: process.env.MAIL_FROM_NAME || 'ChatBI',
    fromAddress: process.env.MAIL_FROM_ADDRESS || 'noreply@example.com',
    codeTtlSeconds: parseInt(process.env.EMAIL_CODE_TTL_SECONDS || '600', 10),
    codeCooldownSeconds: parseInt(process.env.EMAIL_CODE_COOLDOWN_SECONDS || '60', 10),
    codeDailyLimit: parseInt(process.env.EMAIL_CODE_DAILY_LIMIT || '10', 10),
  },

  oauth: {
    google: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    },
    feishu: {
      appId: process.env.FEISHU_OAUTH_APP_ID,
      appSecret: process.env.FEISHU_OAUTH_APP_SECRET,
      redirectUri: process.env.FEISHU_OAUTH_REDIRECT_URI,
    },
  },

  llm: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      timeout: parseInt(process.env.OPENAI_TIMEOUT || '60', 10),
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    },
  },

  sql: {
    maxRows: parseInt(process.env.SQL_MAX_ROWS || '1000', 10),
    timeout: parseInt(process.env.SQL_TIMEOUT || '30', 10),
    cacheTtl: parseInt(process.env.SQL_CACHE_TTL || '3600', 10),
    /** 「导出全量」独立路径上限，不进 LLM */
    exportMaxRows: parseInt(process.env.SQL_EXPORT_MAX_ROWS || '100000', 10),
    exportTimeout: parseInt(process.env.SQL_EXPORT_TIMEOUT || '120', 10),
  },

  vector: {
    enable: process.env.VECTOR_ENABLE === 'true',
    model: process.env.VECTOR_MODEL || 'text-embedding-3-small',
    qdrant: {
      host: process.env.QDRANT_HOST || 'localhost',
      port: parseInt(process.env.QDRANT_PORT || '6333', 10),
      apiKey: process.env.QDRANT_API_KEY,
    },
  },

  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    db: parseInt(process.env.REDIS_DB || '0', 10),
    password: process.env.REDIS_PASSWORD,
  },
}));
