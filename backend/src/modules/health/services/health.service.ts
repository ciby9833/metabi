import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HealthService {
  constructor(private configService: ConfigService) {}

  getHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      app: {
        name: this.configService.get('APP_NAME'),
        version: '0.1.0',
        environment: this.configService.get('NODE_ENV'),
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  getReadiness() {
    return {
      ready: true,
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        redis: 'ok',
        api: 'ok',
      },
    };
  }
}
