import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from '../services/health.service';
import { Public } from '../../auth/decorators/public.decorator';

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: '健康检查' })
  @ApiResponse({ status: 200, description: '服务正常运行' })
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('ready')
  @ApiOperation({ summary: '就绪检查' })
  @ApiResponse({ status: 200, description: '服务已就绪' })
  getReadiness() {
    return this.healthService.getReadiness();
  }
}
