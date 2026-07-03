import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { TurnEvent } from '../../database/entities/turn-event.entity';
import { PlannerAgent, PlannerEvent, PlannerOutput } from '../agents/planner.agent';
import { MasterPlannerAgent, MasterEvent, MasterOutput } from '../agents/master-planner.agent';

/**
 * Generic event union for the runtime — covers both single-skill (PlannerEvent)
 * and master (MasterEvent) generators. Discriminator is the `type` field.
 */
export type RuntimeEvent = (PlannerEvent | MasterEvent) & { _seq?: number };

/** Promise + resolver pair used to suspend the generator on clarify_request */
interface PendingClarify {
  resolve: (answer: string | undefined) => void;
  expiresAt: number;
}

/** In-memory state for a live turn — generator + event log + clarify pending */
interface TurnState {
  turnId: string;
  conversationId: string;
  mode: 'single_skill' | 'master';
  /** Underlying generator instance — calls .next(answer) to advance */
  gen: AsyncGenerator<any, PlannerOutput | MasterOutput, string | undefined>;
  /** Events emitted so far this turn (in-memory copy; also persisted to DB) */
  events: RuntimeEvent[];
  /** Per-turn sequence counter */
  nextSeq: number;
  /** Currently registered SSE subscribers — push events to them in real time */
  subscribers: Set<(ev: RuntimeEvent) => void>;
  /** Pending clarify state — set when generator yields clarify_request */
  pendingClarify?: PendingClarify;
  /** Final output once generator completes — null until done */
  finalOutput?: PlannerOutput | MasterOutput;
  /** Set if generator errored */
  errorMessage?: string;
  /** Wall-clock ts of last activity — used for TTL sweep */
  lastActivityAt: number;
  /** Promise that resolves when the entire generator is drained */
  donePromise: Promise<void>;
}

/**
 * Manages live generator state for SSE turns.
 *
 * Lifecycle:
 *   1. createTurn() — spawns generator, runs it in background, returns turnId
 *   2. subscribe(turnId) — connect SSE client; replays past events + tails live
 *   3. submitClarifyAnswer(turnId, answer) — resumes a paused generator
 *   4. Generator finishes → finalOutput set → all subscribers get final events
 *   5. TTL sweeps inactive turns after 30 min
 */
@Injectable()
export class TurnRuntimeService implements OnModuleDestroy {
  private readonly logger = new Logger(TurnRuntimeService.name);
  private readonly turns = new Map<string, TurnState>();
  /** TTL: turn state is purged this long after last activity (default 30 min) */
  private readonly TTL_MS = 30 * 60 * 1000;
  /** Clarify wait timeout — if user doesn't answer in 10 min, treat as no-answer */
  private readonly CLARIFY_TTL_MS = 10 * 60 * 1000;
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(TurnEvent)
    private readonly turnEventRepo: Repository<TurnEvent>,
    private readonly planner: PlannerAgent,
    private readonly master: MasterPlannerAgent,
  ) {
    // Run TTL sweep every 5 min
    this.sweepTimer = setInterval(() => this.sweep(), 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Spawn a turn. Returns immediately with turnId; generator runs in background.
   *
   * The SSE endpoint then calls subscribe(turnId) to attach to the stream.
   */
  createTurn(input: {
    mode: 'single_skill' | 'master';
    question: string;
    datasourceId: string;
    conversationId?: string;
    userId?: string;
    /** 用户上传 dataset 模式：覆盖 Planner 的 allowedTables，跳过 Skill.tables */
    overrideAllowedTables?: string[];
    /** 配合 overrideAllowedTables：dataset 业务描述注入 system prompt */
    datasetContext?: string;
    /** 本轮附件的 preview 文本（table/pdf/text） —— 放 planner system 顶部 */
    attachmentContext?: string;
    /** 本轮 image 附件（vision content block）*/
    currentAttachments?: import('../../providers/llm/types').ChatAttachmentInline[];
  }): { turnId: string } {
    const turnId = randomUUID();
    const gen =
      input.mode === 'master'
        ? this.master.runStream({
            question: input.question,
            datasourceId: input.datasourceId,
            conversationId: input.conversationId,
            userId: input.userId,
            // Master 暂不支持 dataset 模式（master 会派遣子 agent，复杂度高）— 后期扩
            // 附件 preview 塞进 Master system —— 让它感知"有附件在场" 别乱反问
            attachmentContext: input.attachmentContext,
            // image 附件透传：master 走 vision 判定意图，子 planner 处理内容
            currentAttachments: input.currentAttachments,
          })
        : this.planner.runStream({
            question: input.question,
            datasourceId: input.datasourceId,
            conversationId: input.conversationId,
            userId: input.userId,
            overrideAllowedTables: input.overrideAllowedTables,
            datasetContext: input.datasetContext,
            attachmentContext: input.attachmentContext,
            currentAttachments: input.currentAttachments,
          });

    const state: TurnState = {
      turnId,
      conversationId: input.conversationId || '',
      mode: input.mode,
      gen: gen as any,
      events: [],
      nextSeq: 0,
      subscribers: new Set(),
      lastActivityAt: Date.now(),
      donePromise: Promise.resolve(),
    };
    this.turns.set(turnId, state);

    // Kick off the drain loop in background
    state.donePromise = this.driveGenerator(state).catch((err) => {
      const msg = (err as Error).message || String(err);
      this.logger.error(`Turn ${turnId} generator threw: ${msg}`);
      state.errorMessage = msg;
      this.fanout(state, { type: 'error', message: msg });
    });

    return { turnId };
  }

  /** Drives the generator forward, fanning each event to subscribers + DB */
  private async driveGenerator(state: TurnState): Promise<void> {
    let nextAnswer: string | undefined = undefined;
    while (true) {
      const result = await state.gen.next(nextAnswer);
      nextAnswer = undefined;
      if (result.done) {
        state.finalOutput = result.value;
        state.lastActivityAt = Date.now();
        return;
      }
      const ev = result.value as RuntimeEvent;
      await this.recordAndFanout(state, ev);

      // If it's a clarify_request → suspend until user answers
      if (ev.type === 'clarify_request') {
        try {
          nextAnswer = await this.awaitClarify(state);
          if (nextAnswer) {
            // Re-emit a clarify_resolved hint on the local stream (generator
            // also yields one after consuming the answer, but emitting early
            // lets subscribers immediately hide the card without race).
          }
        } catch (err) {
          // Timeout → continue with undefined → generator falls back to clarify-as-finalize
          this.logger.warn(`Turn ${state.turnId} clarify timed out — proceeding without answer`);
          nextAnswer = undefined;
        }
      }
    }
  }

  private async recordAndFanout(state: TurnState, ev: RuntimeEvent): Promise<void> {
    const seq = state.nextSeq++;
    ev._seq = seq;
    state.events.push(ev);
    state.lastActivityAt = Date.now();

    // Persist first — durability before push
    try {
      await this.turnEventRepo.save(
        this.turnEventRepo.create({
          turnId: null, // Will be backfilled when message is created at finalize
          conversationId: state.conversationId || '00000000-0000-0000-0000-000000000000',
          seq,
          type: ev.type,
          payload: ev,
        }),
      );
    } catch (err) {
      // DB hiccup shouldn't break SSE — log + continue
      this.logger.warn(
        `Failed to persist turn_event seq=${seq} type=${ev.type}: ${(err as Error).message}`,
      );
    }

    this.fanout(state, ev);
  }

  private fanout(state: TurnState, ev: RuntimeEvent): void {
    for (const sub of state.subscribers) {
      try {
        sub(ev);
      } catch (err) {
        this.logger.debug(`Subscriber threw: ${(err as Error).message}`);
      }
    }
  }

  /** Suspend until either user answers via submitClarifyAnswer, or CLARIFY_TTL expires */
  private awaitClarify(state: TurnState): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const expiresAt = Date.now() + this.CLARIFY_TTL_MS;
      const timeout = setTimeout(() => {
        if (state.pendingClarify) {
          state.pendingClarify = undefined;
          reject(new Error('clarify_timeout'));
        }
      }, this.CLARIFY_TTL_MS);

      state.pendingClarify = {
        expiresAt,
        resolve: (answer) => {
          clearTimeout(timeout);
          state.pendingClarify = undefined;
          resolve(answer);
        },
      };
    });
  }

  /**
   * Subscribe to a live turn's events.
   *
   * On subscribe, immediately replays all past events (so SSE reconnect is lossless),
   * then keeps tailing live events. Returns an unsubscribe function.
   */
  subscribe(turnId: string, onEvent: (ev: RuntimeEvent) => void): () => void {
    const state = this.turns.get(turnId);
    if (!state) {
      onEvent({ type: 'error', message: `turn ${turnId} not found or expired` });
      return () => {};
    }

    // Replay history first
    for (const past of state.events) {
      try {
        onEvent(past);
      } catch (err) {
        this.logger.debug(`Replay subscriber threw: ${(err as Error).message}`);
      }
    }

    // Tail live events
    state.subscribers.add(onEvent);
    return () => {
      state.subscribers.delete(onEvent);
    };
  }

  /** Provide a user answer for a pending clarify_request. */
  submitClarifyAnswer(turnId: string, answer: string): { ok: boolean; reason?: string } {
    const state = this.turns.get(turnId);
    if (!state) return { ok: false, reason: 'turn not found or expired' };
    if (!state.pendingClarify) return { ok: false, reason: 'no clarify pending' };
    state.pendingClarify.resolve(answer);
    state.lastActivityAt = Date.now();
    return { ok: true };
  }

  /** Wait for the turn generator to finish, return final output */
  async awaitDone(turnId: string): Promise<PlannerOutput | MasterOutput | null> {
    const state = this.turns.get(turnId);
    if (!state) return null;
    await state.donePromise;
    return state.finalOutput || null;
  }

  /** Get current state (for inspection / finalize backfill in chat service) */
  getState(turnId: string): TurnState | undefined {
    return this.turns.get(turnId);
  }

  /** Release the in-memory state for a completed turn */
  releaseTurn(turnId: string): void {
    this.turns.delete(turnId);
  }

  /** Periodically evict turns inactive beyond TTL */
  private sweep(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [turnId, state] of this.turns) {
      if (now - state.lastActivityAt > this.TTL_MS) {
        this.turns.delete(turnId);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.log(`TTL sweep: evicted ${evicted} inactive turn(s)`);
    }
  }
}
