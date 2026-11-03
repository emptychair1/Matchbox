import type { MatchContext, MatchExecutionOutcome, MatchRecord, MatchSpec } from './contract.js';

/** Adapter must durably persist both calls; settle must atomically require pending status. */
export interface StrikeRecorder {
  createPending(record: MatchRecord): Promise<void>;
  settle(strikeId: string, outcome: MatchExecutionOutcome<unknown>, durationMs: number): Promise<void>;
}

export interface MatchLogger {
  event(event: Readonly<{ type: 'strike' | 'light' | 'dud' | 'blocked' | 'recording-error'; strikeId: string; matchName: string }>): void;
}

export interface MatchboxOptions<Dependencies> {
  readonly matches: readonly MatchSpec<any, any, Dependencies>[];
  readonly recorder: StrikeRecorder;
  readonly dependencies: Readonly<Dependencies>;
  readonly logger?: MatchLogger;
  readonly defaultTimeoutMs?: number;
  readonly makeId?: () => string;
  readonly now?: () => number;
}

export interface DispatchOptions {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface Strike<Value> {
  readonly strikeId: string;
  readonly matchName: string;
  readonly sessionId: string;
  readonly durationMs: number;
  readonly outcome: MatchExecutionOutcome<Value>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMatchbox<Dependencies>(options: MatchboxOptions<Dependencies>) {
  if (!options?.recorder || typeof options.recorder.createPending !== 'function' || typeof options.recorder.settle !== 'function') {
    throw new TypeError('A durable recorder with createPending and settle is required');
  }
  const clock = options.now ?? Date.now;
  const makeId = options.makeId ?? (() => crypto.randomUUID());
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) throw new TypeError('Invalid default timeout');
  const matches = new Map<string, MatchSpec<any, any, Dependencies>>();
  function register(match: MatchSpec<any, any, Dependencies>) {
    if (!match || !match.name?.trim() || typeof match.input?.parse !== 'function' || typeof match.run !== 'function' || typeof match.verify !== 'function') {
      throw new TypeError('Invalid match contract');
    }
    if (matches.has(match.name)) throw new Error(`Duplicate match: ${match.name}`);
    matches.set(match.name, match);
  }
  for (const match of options.matches) register(match);

  function log(type: 'strike' | 'light' | 'dud' | 'blocked' | 'recording-error', strikeId: string, matchName: string) {
    try { options.logger?.event({ type, strikeId, matchName }); } catch { /* non-authoritative telemetry */ }
  }

  async function dispatch<Value = unknown>(name: string, rawInput: unknown, request: DispatchOptions): Promise<Strike<Value>> {
    if (!request?.sessionId?.trim()) throw new TypeError('sessionId is required');
    const started = clock();
    const strikeId = makeId();
    const match = matches.get(name);
    let input: unknown;
    let blocked: string | undefined;
    let summary = '[redacted]';
    try {
      if (!match) throw new Error('Match not registered');
      input = match.input.parse(rawInput);
      if (match.summarizeInput) {
        const candidate = match.summarizeInput(input);
        if (typeof candidate !== 'string' || candidate.length > 256) throw new Error('Unsafe input summary');
        summary = candidate;
      }
    } catch (error) {
      blocked = errorMessage(error);
    }
    const timeoutMs = match?.timeoutMs ?? defaultTimeoutMs;
    const record: MatchRecord = {
      strikeId, matchName: name, sessionId: request.sessionId,
      inputSummary: summary,
      startedAt: new Date(started).toISOString(),
      deadlineAt: new Date(started + timeoutMs).toISOString(),
      status: 'pending'
    };
    // Fail closed: no match code runs without a durable intent.
    try {
      await options.recorder.createPending(record);
    } catch (error) {
      log('recording-error', strikeId, name);
      return { strikeId, matchName: name, sessionId: request.sessionId, durationMs: clock() - started,
        outcome: { status: 'blocked', reason: `Strike recording failed: ${errorMessage(error)}` } };
    }
    log('strike', strikeId, name);
    let outcome: MatchExecutionOutcome<unknown>;
    if (blocked !== undefined) {
      outcome = { status: 'blocked', reason: blocked };
    } else {
      const controller = new AbortController();
      const onAbort = () => controller.abort(request.signal?.reason);
      if (request.signal?.aborted) controller.abort(request.signal.reason);
      else request.signal?.addEventListener('abort', onAbort, { once: true });
      const context: MatchContext<Dependencies> = { sessionId: request.sessionId, dependencies: options.dependencies, signal: controller.signal };
      try {
        if (controller.signal.aborted) {
          outcome = { status: 'blocked', reason: 'Dispatch aborted before execution' };
        } else {
          const value = await match!.run(input, context);
          const verified = await match!.verify(value, input, context);
          outcome = verified === true ? { status: 'light', value } : { status: 'dud', error: 'Result not verified' };
        }
      } catch (error) {
        outcome = { status: 'dud', error: errorMessage(error) };
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
      }
    }
    const durationMs = clock() - started;
    try {
      await options.recorder.settle(strikeId, outcome, durationMs);
    } catch (error) {
      log('recording-error', strikeId, name);
      // Actual side effects may already have occurred. NEVER claim a light here.
      throw new Error(`Terminal recording failed for ${strikeId}; underlying outcome unknown: ${errorMessage(error)}`);
    }
    log(outcome.status, strikeId, name);
    return { strikeId, matchName: name, sessionId: request.sessionId, durationMs, outcome: outcome as MatchExecutionOutcome<Value> };
  }

  return Object.freeze({ dispatch, names: () => [...matches.keys()] });
}
