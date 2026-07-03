import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { BaseLLMProvider } from './providers/base.provider';
import {
  ChatMessage,
  ConversationMessage,
  EmbeddingResponse,
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
  LLMScenario,
  LLMToolResponse,
  ToolDeclaration,
} from './types';

/**
 * LLM Gateway - 统一的 LLM 调用入口
 *
 * 职责：
 * 1. 多 Provider 管理
 * 2. 按场景路由（SQL 生成→ GPT-4o，批量任务→ DeepSeek）
 * 3. 重试与降级
 * 4. 日志与指标
 */
@Injectable()
export class LLMGatewayService {
  private readonly logger = new Logger(LLMGatewayService.name);
  private readonly providers: Map<LLMProvider, BaseLLMProvider>;

  /** 场景 → 默认 provider 路由表（Claude 优先用于智能要求高的场景）*/
  private readonly scenarioRoutes: Record<LLMScenario, LLMProvider[]> = {
    [LLMScenario.SQL_GENERATION]: [LLMProvider.ANTHROPIC, LLMProvider.OPENAI, LLMProvider.GEMINI, LLMProvider.DEEPSEEK],
    [LLMScenario.NARRATIVE]: [LLMProvider.ANTHROPIC, LLMProvider.GEMINI, LLMProvider.OPENAI, LLMProvider.DEEPSEEK],
    [LLMScenario.INTENT_DETECTION]: [LLMProvider.DEEPSEEK, LLMProvider.OPENAI, LLMProvider.ANTHROPIC],
    [LLMScenario.CHART_GENERATION]: [LLMProvider.OPENAI, LLMProvider.ANTHROPIC, LLMProvider.GEMINI],
    [LLMScenario.DEFAULT]: [LLMProvider.ANTHROPIC, LLMProvider.OPENAI, LLMProvider.GEMINI, LLMProvider.DEEPSEEK],
    [LLMScenario.EMBEDDING]: [LLMProvider.OPENAI],
  };

  constructor(
    private readonly configService: ConfigService,
    openai: OpenAIProvider,
    gemini: GeminiProvider,
    deepseek: DeepSeekProvider,
    anthropic: AnthropicProvider,
  ) {
    this.providers = new Map<LLMProvider, BaseLLMProvider>();
    this.providers.set(LLMProvider.OPENAI, openai);
    this.providers.set(LLMProvider.GEMINI, gemini);
    this.providers.set(LLMProvider.DEEPSEEK, deepseek);
    this.providers.set(LLMProvider.ANTHROPIC, anthropic);

    const enabledList = Array.from(this.providers.values())
      .filter((p) => p.isEnabled())
      .map((p) => p.providerName);
    this.logger.log(`LLM Gateway initialized. Enabled providers: ${enabledList.join(', ') || 'none'}`);
  }

  /**
   * 调用 LLM。按场景自动选择 provider，失败自动降级到下一个。
   */
  async call(messages: ChatMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    const scenario = options?.scenario || LLMScenario.DEFAULT;
    const candidates = options?.provider
      ? [options.provider]
      : this.scenarioRoutes[scenario] || this.scenarioRoutes[LLMScenario.DEFAULT];

    let lastError: Error | undefined;
    for (const providerName of candidates) {
      const provider = this.providers.get(providerName);
      if (!provider || !provider.isEnabled()) continue;

      try {
        this.logger.debug(`Calling ${providerName} for scenario=${scenario}`);
        const response = await provider.callChat(messages, options);
        this.logger.debug(
          `${providerName} responded in ${response.latencyMs}ms` +
            (response.usage ? ` (tokens=${response.usage.totalTokens})` : ''),
        );
        return response;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`${providerName} failed: ${lastError.message}. Trying next provider.`);
        this.maybeDisableProvider(provider, lastError);
      }
    }
    throw new Error(
      `All LLM providers failed for scenario ${scenario}. Last error: ${lastError?.message || 'no providers available'}`,
    );
  }

  /**
   * 带工具调用的对话。按场景选 provider，失败自动降级。
   */
  async callWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    const scenario = options?.scenario || LLMScenario.SQL_GENERATION;
    const candidates = options?.provider
      ? [options.provider]
      : this.scenarioRoutes[scenario] || this.scenarioRoutes[LLMScenario.DEFAULT];

    let lastError: Error | undefined;
    for (const providerName of candidates) {
      const provider = this.providers.get(providerName);
      if (!provider || !provider.isEnabled()) continue;

      try {
        this.logger.debug(`callWithTools → ${providerName}`);
        const response = await provider.callWithTools(messages, tools, options);
        this.logger.debug(
          `${providerName} responded ${response.type} in ${response.latencyMs}ms` +
            (response.usage ? ` (tokens=${response.usage.totalTokens})` : ''),
        );
        return response;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `${providerName} tool-call failed: ${lastError.message}. Trying next provider.`,
        );
        this.maybeDisableProvider(provider, lastError);
      }
    }
    throw new Error(
      `All LLM providers failed tool-call. Last error: ${lastError?.message || 'no providers available'}`,
    );
  }

  /**
   * 流式带工具调用 — SSE / generator 场景。
   * 不做 fallback：流式失败直接抛，因为已经开始 yield 事件不好回滚。
   * 选 provider：按 scenario 路由的第一个。
   */
  async *streamWithTools(
    messages: ConversationMessage[],
    tools: ToolDeclaration[],
    options?: LLMCallOptions,
  ): AsyncGenerator<import('./types').LLMStreamEvent, void, void> {
    const scenario = options?.scenario || LLMScenario.SQL_GENERATION;
    const candidates = options?.provider
      ? [options.provider]
      : this.scenarioRoutes[scenario] || this.scenarioRoutes[LLMScenario.DEFAULT];

    const providerName = candidates.find((n) => {
      const p = this.providers.get(n);
      return p && p.isEnabled();
    });
    if (!providerName) {
      yield { type: 'error', message: 'No enabled LLM provider available' };
      return;
    }
    const provider = this.providers.get(providerName)!;
    this.logger.debug(`streamWithTools → ${providerName}`);
    yield* provider.streamWithTools(messages, tools, options);
  }

  /**
   * 如果错误属于「认证失败」类（401/403），自动 disable provider，
   * 避免后续每次调用都重复浪费时间和日志。
   */
  private maybeDisableProvider(provider: BaseLLMProvider, error: Error): void {
    const msg = (error.message || '').toLowerCase();
    const isAuthError =
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('authentication') ||
      msg.includes('incorrect api key') ||
      msg.includes('invalid api key') ||
      msg.includes('api key not valid');

    if (isAuthError) {
      provider.setEnabled(false);
      this.logger.warn(
        `❌ Provider '${provider.providerName}' auto-disabled due to authentication error. Set a valid API key and restart to re-enable.`,
      );
    }
  }

  /** 生成嵌入向量 */
  async embed(text: string): Promise<EmbeddingResponse> {
    const provider = this.providers.get(LLMProvider.OPENAI);
    if (!provider || !provider.isEnabled()) {
      throw new Error('No embedding provider available');
    }
    return provider.embed(text);
  }

  /** 列出可用 Provider */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.values())
      .filter((p) => p.isEnabled())
      .map((p) => p.providerName);
  }
}
