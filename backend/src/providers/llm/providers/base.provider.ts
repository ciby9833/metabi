import {
  ChatMessage,
  ConversationMessage,
  EmbeddingResponse,
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMToolResponse,
  ToolDeclaration,
} from '../types';

/**
 * LLM Provider 抽象基类
 * 所有具体 Provider 需继承并实现 callChat / embed 方法
 */
export abstract class BaseLLMProvider {
  abstract readonly providerName: LLMProvider;
  protected enabled = true;

  abstract callChat(messages: ChatMessage[], options?: LLMCallOptions): Promise<LLMResponse>;

  /** 带工具调用的对话（可选实现） */
  async callWithTools(
    _messages: ConversationMessage[],
    _tools: ToolDeclaration[],
    _options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    throw new Error(`Provider ${this.providerName} does not support tool calling`);
  }

  /**
   * 流式带工具调用对话（SSE 模式必备）。
   * Provider 通过 yield LLMStreamEvent 实时推送增量。
   * 默认未实现 — Provider 必须重写支持。
   */
  async *streamWithTools(
    _messages: ConversationMessage[],
    _tools: ToolDeclaration[],
    _options?: LLMCallOptions,
  ): AsyncGenerator<LLMStreamEvent, void, void> {
    throw new Error(`Provider ${this.providerName} does not support streaming tool calling`);
  }

  /** 嵌入向量生成（可选实现）*/
  async embed(_text: string): Promise<EmbeddingResponse> {
    throw new Error(`Provider ${this.providerName} does not support embeddings`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }
}
