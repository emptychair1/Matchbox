import type { MatchContext, MatchExecutionOutcome, MatchRecord, MatchSpec } from './contract.js';

/** Adapter must durably persist both calls; settle must atomically require pending status. */
export interface StrikeRecorder {
  createPending(record: MatchRecord): Promise<void>;
  /** Atomic compare-and-set: only a still-pending strike may settle. */
  settle(strikeId: string, outcome: MatchExecutionOutcome<unknown>, durationMs: number): Promise<void>;
  /** Optional lease renewal: atomic pending-only extension; false if already closed. */
  renewLease?(strikeId: string, deadlineAt: string): Promise<boolean>;
  /** Append-only conflict evidence; must not overwrite a reconciled terminal record. */
  recordLateCompletion?(strikeId: string, outcome: MatchExecutionOutcome<unknown>): Promise<void>;
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
  /** Defaults to one third of the configured lease duration when renewal is supported. */
  readonly heartbeatIntervalMs?: number;
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
  if (options.heartbeatIntervalMs !== undefined && (!Number.isFinite(options.heartbeatIntervalMs) || options.heartbeatIntervalMs <= 0)) {
    throw new TypeError('Invalid heartbeat interval');
  }
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
      // A lease is renewed only while the match is active. The storage adapter
      // must atomically reject renewal after reconciliation or settlement.
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let leaseError: Error | undefined;
      let renewalBusy = false;
      if (options.recorder.renewLease && !controller.signal.aborted) {
        const every = options.heartbeatIntervalMs ?? Math.max(1, Math.floor(timeoutMs / 3));
        heartbeat = setInterval(() => {
          if (renewalBusy || controller.signal.aborted) return;
          renewalBusy = true;
          const deadline = new Date(clock() + timeoutMs).toISOString();
          void options.recorder.renewLease!(strikeId, deadline).then(ok => {
            if (!ok) throw new Error('Strike lease lost');
          }).catch(error => {
            leaseError = new Error(`Lease renewal failed: ${errorMessage(error)}`);
            controller.abort(leaseError);
          }).finally(() => { renewalBusy = false; });
        }, every);
      }
      try {
        if (controller.signal.aborted) {
          outcome = { status: 'blocked', reason: 'Dispatch aborted before execution' };
        } else {
          const value = await match!.run(input, context);
          if (leaseError || controller.signal.aborted) {
            throw leaseError ?? new Error('Execution aborted; outcome not confirmed');
          }
          const verified = await match!.verify(value, input, context);
          if (leaseError || controller.signal.aborted) {
            throw leaseError ?? new Error('Verification aborted; outcome not confirmed');
          }
          outcome = verified === true ? { status: 'light', value } : { status: 'dud', error: 'Result not verified' };
        }
      } catch (error) {
        // Losing the lease is not proof of operation failure. Preserve the
        // pending intent for the reconciler instead of recording a false dud.
        if (leaseError) {
          throw new Error(`Lease lost for ${strikeId}; underlying outcome unknown: ${errorMessage(leaseError)}`);
        }
        outcome = { status: 'dud', error: errorMessage(error) };
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        request.signal?.removeEventListener('abort', onAbort);
      }
    }
    const durationMs = clock() - started;
    try {
      await options.recorder.settle(strikeId, outcome, durationMs);
    } catch (error) {
      log('recording-error', strikeId, name);
      if (options.recorder.recordLateCompletion) {
        try { await options.recorder.recordLateCompletion(strikeId, outcome); }
        catch { /* preserve the original terminal recording error */ }
      }
      // Side effects may already have occurred, or a reconciler may have won.
      // Do not turn an interrupted record into a light or report success.
      throw new Error(`Terminal recording failed for ${strikeId}; underlying outcome unknown: ${errorMessage(error)}`);
    }
    log(outcome.status, strikeId, name);
    return { strikeId, matchName: name, sessionId: request.sessionId, durationMs, outcome: outcome as MatchExecutionOutcome<Value> };
  }

  return Object.freeze({ dispatch, names: () => [...matches.keys()] });
}
