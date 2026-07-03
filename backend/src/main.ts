import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get('PORT') || 3000;
  // 全局前缀含版本号 (例：api/v1)，前端服务层会调用 `${baseURL}/v1/...`
  // 这里默认带上 v1，避免与前端约定不一致。
  const apiPrefix = configService.get('API_PREFIX') || 'api/v1';
  const appName = configService.get('APP_NAME') || 'ChatBI';
  const nodeEnv = configService.get('NODE_ENV') || 'development';

  // 设置全局前缀
  app.setGlobalPrefix(apiPrefix);

  // 启用 CORS
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });

  // 全局异常过滤器：把真实错误信息吐出来
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle(appName)
    .setDescription('Intelligent Data Analysis Conversational Platform API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addServer(`http://localhost:${port}/${apiPrefix}`, 'Local development')
    .addTag('Health', 'Health check endpoints')
    .addTag('Chat', 'Chat conversation endpoints')
    .addTag('Datasource', 'Data source management')
    .addTag('Task', 'Scheduled task management')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`✅ ${appName} is running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`📚 API Documentation: http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`🌍 Environment: ${nodeEnv}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
