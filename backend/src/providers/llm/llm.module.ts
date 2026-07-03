import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenAIProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { LLMGatewayService } from './llm-gateway.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    OpenAIProvider,
    GeminiProvider,
    DeepSeekProvider,
    AnthropicProvider,
    LLMGatewayService,
  ],
  exports: [LLMGatewayService],
})
export class LLMModule {}
