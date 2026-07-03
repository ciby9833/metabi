import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('db', () => ({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'chatbi_user',
  password: process.env.DATABASE_PASSWORD || 'chatbi_password',
  name: process.env.DATABASE_NAME || 'chatbi_db',
  url: process.env.DATABASE_URL,
  logging: process.env.NODE_ENV === 'development',
  synchronize: process.env.NODE_ENV === 'development',
}));
