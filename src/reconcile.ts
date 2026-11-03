import type { MatchRecord } from './contract.js';
import type { StrikeRecorder } from './engine.js';

/** Host adapter must provide atomic state transitions and durable event history. */
export interface ReconciliationRecorder extends StrikeRecorder {
  /** Return only records whose current lease deadline has passed. */
  listExpiredPending(nowIso: string, limit: number): Promise<readonly MatchRecord[]>;
  /** CAS pending -> interrupted only if still expired; false means a competing writer won. */
  interruptIfExpired(strikeId: string, nowIso: string, reason: string): Promise<boolean>;
}

export interface ReconcileOptions {
  readonly recorder: ReconciliationRecorder;
  readonly now?: () => number;
  readonly batchSize?: number;
  readonly owner: string;
}

export interface ReconcileReport {
  readonly owner: string;
  readonly examined: number;
  readonly interrupted: number;
  readonly raced: number;
  readonly strikeIds: readonly string[];
}

/**
 * Caller (Calcifer) owns the schedule, concurrency, and observability.
 * This pass never guesses an external result or retries an operation.
 */
export async function reconcileExpired(options: ReconcileOptions): Promise<ReconcileReport> {
  if (!options?.owner?.trim()) throw new TypeError('Reconciler owner is required');
  if (!options.recorder || typeof options.recorder.listExpiredPending !== 'function'
    || typeof options.recorder.interruptIfExpired !== 'function') {
    throw new TypeError('Reconciliation recorder requires listExpiredPending and interruptIfExpired');
  }
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new RangeError('batchSize must be 1..1000');
  }
  const nowIso = new Date((options.now ?? Date.now)()).toISOString();
  const candidates = await options.recorder.listExpiredPending(nowIso, batchSize);
  if (candidates.length > batchSize) throw new Error('Recorder exceeded batchSize');
  const strikeIds: string[] = [];
  let raced = 0;
  for (const record of candidates) {
    // Never trust a stale listing without a final CAS at the storage boundary.
    if (record.status !== 'pending' || record.deadlineAt > nowIso) {
      raced++;
      continue;
    }
    const closed = await options.recorder.interruptIfExpired(
      record.strikeId, nowIso, 'Lease expired; operation outcome unknown'
    );
    if (closed) strikeIds.push(record.strikeId);
    else raced++;
  }
  return Object.freeze({
    owner: options.owner, examined: candidates.length, interrupted: strikeIds.length,
    raced, strikeIds
  });
}
