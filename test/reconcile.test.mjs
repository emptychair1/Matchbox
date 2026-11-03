import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchbox, reconcileExpired } from '../dist/src/index.js';

function durableRecorder() {
  const rows = new Map();
  const history = [];
  return {
    rows, history,
    async createPending(rec) {
      if (rows.has(rec.strikeId)) throw Error('duplicate strike');
      rows.set(rec.strikeId, { ...rec });
      history.push({ type: 'pending', strikeId: rec.strikeId });
    },
    async settle(id, outcome, durationMs) {
      const row = rows.get(id);
      if (!row || row.status !== 'pending') throw Error('not pending');
      row.status = outcome.status; row.durationMs = durationMs;
      history.push({ type: outcome.status, strikeId: id });
    },
    async renewLease(id, deadlineAt) {
      const row = rows.get(id);
      if (!row || row.status !== 'pending') return false;
      if (deadlineAt > row.deadlineAt) row.deadlineAt = deadlineAt;
      history.push({ type: 'renew', strikeId: id });
      return true;
    },
    async listExpiredPending(nowIso, limit) {
      return [...rows.values()].filter(r => r.status === 'pending' && r.deadlineAt <= nowIso).slice(0, limit);
    },
    async interruptIfExpired(id, nowIso, reason) {
      const row = rows.get(id);
      if (!row || row.status !== 'pending' || row.deadlineAt > nowIso) return false;
      row.status = 'interrupted'; row.error = reason;
      history.push({ type: 'interrupted', strikeId: id });
      return true;
    },
    async recordLateCompletion(id, outcome) {
      history.push({ type: 'late', strikeId: id, status: outcome.status });
    }
  };
}

const basicMatch = (name, run) => ({
  name, input: { parse(x) { return x; } }, run, verify: () => true, timeoutMs: 100
});

test('reconciler closes expired pending but leaves live leases', async () => {
  const r = durableRecorder();
  await r.createPending({ strikeId: 'old', matchName: 'forge', sessionId: 's',
    inputSummary: '[redacted]', startedAt: '2026-01-01T00:00:00.000Z',
    deadlineAt: '2026-01-01T00:00:01.000Z', status: 'pending' });
  await r.createPending({ strikeId: 'live', matchName: 'voice', sessionId: 's',
    inputSummary: '[redacted]', startedAt: '2026-01-01T00:00:00.000Z',
    deadlineAt: '2027-01-01T00:00:01.000Z', status: 'pending' });
  const result = await reconcileExpired({ recorder: r, owner: 'calcifer', now: () => Date.parse('2026-01-02T00:00:00Z') });
  assert.equal(result.interrupted, 1);
  assert.equal(r.rows.get('old').status, 'interrupted');
  assert.equal(r.rows.get('live').status, 'pending');
});

test('reconciler race lost to a successful settle does not rewrite history', async () => {
  const r = durableRecorder();
  await r.createPending({ strikeId: 'x', matchName: 'forge', sessionId: 's',
    inputSummary: '[redacted]', startedAt: '2026-01-01T00:00:00Z',
    deadlineAt: '2026-01-01T00:00:01Z', status: 'pending' });
  const original = r.interruptIfExpired.bind(r);
  r.interruptIfExpired = async (...args) => {
    await r.settle('x', { status: 'light', value: 'confirmed' }, 10);
    return original(...args);
  };
  const report = await reconcileExpired({ recorder: r, owner: 'calcifer', now: () => Date.parse('2026-01-02T00:00:00Z') });
  assert.equal(report.interrupted, 0);
  assert.equal(report.raced, 1);
  assert.equal(r.rows.get('x').status, 'light');
});

test('late completion after interrupted cannot become a light', async () => {
  const r = durableRecorder();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const box = createMatchbox({ matches: [basicMatch('forge', async () => { await gate; return 'commit'; })],
    recorder: r, dependencies: {}, now: () => Date.parse('2026-01-02T00:00:00Z'), makeId: () => 'late' });
  const ongoing = box.dispatch('forge', 'write', { sessionId: 's' });
  await new Promise(resolve => setImmediate(resolve));
  const closed = await reconcileExpired({ recorder: r, owner: 'calcifer', now: () => Date.parse('2026-01-03T00:00:00Z') });
  assert.equal(closed.interrupted, 1);
  release();
  await assert.rejects(ongoing, /outcome unknown/);
  assert.equal(r.rows.get('late').status, 'interrupted');
  assert.ok(r.history.some(x => x.type === 'late'));
});

test('heartbeat renews a long-running lease without turning it into a light prematurely', async () => {
  const r = durableRecorder();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const box = createMatchbox({ matches: [basicMatch('reading', async () => { await gate; return 'done'; })],
    recorder: r, dependencies: {}, heartbeatIntervalMs: 5, makeId: () => 'beat' });
  const ongoing = box.dispatch('reading', 'book', { sessionId: 's' });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(r.history.some(x => x.type === 'renew'));
  assert.equal(r.rows.get('beat').status, 'pending');
  release();
  assert.equal((await ongoing).outcome.status, 'light');
});

test('reconciler requires owner and refuses unsafe batch size', async () => {
  const r = durableRecorder();
  await assert.rejects(reconcileExpired({ recorder:r, owner:'' }), /owner/);
  await assert.rejects(reconcileExpired({ recorder:r, owner:'calcifer', batchSize:0 }), /batchSize/);
});

test('lost lease does not misreport unknown side effects as a dud', async () => {
  const r = durableRecorder();
  r.renewLease = async () => false;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const box = createMatchbox({
    matches: [basicMatch('forge', async () => { await gate; return 'commit'; })],
    recorder: r, dependencies: {}, heartbeatIntervalMs: 5
  });
  const ongoing = box.dispatch('forge', 'write', { sessionId: 's' });
  await new Promise(resolve => setTimeout(resolve, 25));
  release();
  await assert.rejects(ongoing, /underlying outcome unknown/);
  assert.equal([...r.rows.values()][0].status, 'pending');
  assert.ok(!r.history.some(x => x.type === 'dud'));
});
