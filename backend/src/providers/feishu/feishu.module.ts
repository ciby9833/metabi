import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeishuService } from './feishu.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [FeishuService],
  exports: [FeishuService],
})
export class FeishuModule {}
