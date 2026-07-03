/**
 * LLM Gateway 通用类型定义
 */

export enum LLMProvider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  DEEPSEEK = 'deepseek',
  ANTHROPIC = 'anthropic',
  QWEN = 'qwen',
}

export enum LLMScenario {
  /** SQL 生成 - 高准确率需求 */
  SQL_GENERATION = 'sql_generation',
  /** 自然语言总结 - 中等准确率 */
  NARRATIVE = 'narrative',
  /** 意图理解 - 快速响应 */
  INTENT_DETECTION = 'intent_detection',
  /** 图表配置 - 结构化输出 */
  CHART_GENERATION = 'chart_generation',
  /** 默认/通用 */
  DEFAULT = 'default',
  /** 嵌入向量 */
  EMBEDDING = 'embedding',
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * 附加视觉/文档内容 —— 仅 user 消息可带
   *
   * Provider 支持时（Anthropic Claude vision / OpenAI GPT-4o）走多模态 content block；
   * 不支持时 provider 应把 text preview 内嵌进 content
   */
  attachments?: ChatAttachmentInline[];
}

/** 消息内嵌附件 — 已解析成 provider 可直接消费的形态 */
export interface ChatAttachmentInline {
  /** 用户可见的文件名 —— provider 会把它包在 xml tag 里作为上下文 */
  filename: string;
  kind: 'image' | 'table' | 'pdf' | 'text';
  /** image 必填：base64 数据 + mime */
  imageBase64?: string;
  imageMime?: string;
  /** 非 image：直接把 preview 序列化成 xml/text 塞给 LLM */
  textBlock?: string;
}

export interface LLMCallOptions {
  scenario?: LLMScenario;
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  stream?: boolean;
  timeout?: number;
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  raw?: any;
}

/** 一次 LLM 调用产出的 tool call 请求 */
export interface ToolCallRequest {
  /** Provider 给的调用 ID，回传 tool result 时需要带上 */
  id: string;
  /** 工具名 */
  name: string;
  /** 入参（已经 JSON.parse 后的对象）*/
  arguments: Record<string, any>;
  /** Gemini 2.5+ 专属：模型生成的 thought signature，回传 functionCall 时必须原样带回 */
  thoughtSignature?: string;
}

/** Tool calling 模式下的 LLM 响应：要么是"我要调工具"，要么是"我答完了"（文本）*/
export interface LLMToolResponse {
  /** 'tool_calls' = 要调用工具；'message' = 输出文字（结束） */
  type: 'tool_calls' | 'message';
  toolCalls?: ToolCallRequest[];
  content?: string;
  provider: LLMProvider;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  raw?: any;
}

/** Tool 调用的工具描述（喂给 LLM 的 schema）*/
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: any;
}

/** 工具结果在历史里的位置 */
export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  toolName: string;
  content: string; // JSON 字符串化的工具输出
}

export type ConversationMessage = ChatMessage | AssistantToolCallMessage | ToolResultMessage;

export interface AssistantToolCallMessage {
  role: 'assistant';
  /** 助手要调用的工具 */
  toolCalls: ToolCallRequest[];
  /** 助手可能附带的文字（可空）*/
  content?: string;
}

export interface EmbeddingResponse {
  vector: number[];
  model: string;
  dimensions: number;
}

/**
 * 流式 LLM 事件 — 用于 SSE / generator 场景。
 * 由 LLMGateway.stream() 产出，PlannerAgent generator 转发给上游。
 *
 * tool_call_start → 一个或多个 tool_call_args_delta → tool_call_end 是一组完整的工具调用，
 * 期间 arguments 是分片 JSON 字符串，调用方负责拼接 + parse。
 *
 * text_delta 是 narrative 的增量文本。
 *
 * message_end 标志 LLM 一次 turn 结束（不代表整个 ReAct loop 结束）。
 */
export type LLMStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; thoughtSignature?: string }
  | { type: 'tool_call_args_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | {
      type: 'message_end';
      finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | { type: 'error'; message: string; code?: string };
