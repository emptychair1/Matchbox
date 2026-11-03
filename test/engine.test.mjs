import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchbox } from '../dist/src/index.js';

function recorder() {
  const history = [];
  return {
    history,
    async createPending(record) { history.push({ kind: 'pending', ...record }); },
    async settle(id, outcome, durationMs) { history.push({ kind: 'terminal', id, outcome, durationMs }); }
  };
}
const match = (name, run, verify = () => true) => ({
  name,
  input: { parse(value) { if (typeof value !== 'string') throw Error('not a string'); return value; } },
  run,
  verify
});

test('intent precedes execution; terminal write precedes light', async () => {
  const r = recorder(), trace = [];
  const box = createMatchbox({
    matches: [match('clock', () => { trace.push('run'); return 'ok'; })],
    recorder: {
      async createPending(x) { trace.push('intent'); await r.createPending(x); },
      async settle(...args) { trace.push('terminal'); await r.settle(...args); }
    },
    dependencies: {}
  });
  const result = await box.dispatch('clock', 'time', { sessionId: 's' });
  assert.equal(result.outcome.status, 'light');
  assert.deepEqual(trace, ['intent', 'run', 'terminal']);
  assert.equal(r.history[0].status, 'pending');
  assert.equal(r.history[1].outcome.status, 'light');
});
test('invalid input is blocked without execution', async () => {
  const r = recorder(); let called = false;
  const box = createMatchbox({ matches: [match('clock', () => { called = true; return 'x'; })], recorder: r, dependencies: {} });
  const result = await box.dispatch('clock', 4, { sessionId: 's' });
  assert.equal(result.outcome.status, 'blocked');
  assert.equal(called, false);
  assert.equal(r.history[1].outcome.status, 'blocked');
});
test('intent-recording failure prevents execution', async () => {
  let called = false;
  const r = recorder();
  r.createPending = async () => { throw Error('offline'); };
  const box = createMatchbox({ matches: [match('voice', () => { called = true; return 'x'; })], recorder: r, dependencies: {} });
  const result = await box.dispatch('voice', 'hi', { sessionId: 's' });
  assert.equal(result.outcome.status, 'blocked');
  assert.equal(called, false);
});
test('terminal-recording failure cannot report light', async () => {
  let called = false;
  const r = recorder();
  r.settle = async () => { throw Error('offline'); };
  const box = createMatchbox({ matches: [match('forge', () => { called = true; return 'sha'; })], recorder: r, dependencies: {} });
  await assert.rejects(box.dispatch('forge', 'commit', { sessionId: 's' }), /underlying outcome unknown/);
  assert.equal(called, true);
  assert.equal(r.history[0].status, 'pending');
});
test('dud cannot break a subsequent match', async () => {
  const box = createMatchbox({
    matches: [match('clock', () => { throw Error('broken'); }), match('voice', () => 'alive')],
    recorder: recorder(),
    dependencies: {}
  });
  assert.equal((await box.dispatch('clock', 'x', { sessionId: 's' })).outcome.status, 'dud');
  assert.equal((await box.dispatch('voice', 'x', { sessionId: 's' })).outcome.status, 'light');
});
test('unverified external success is dud', async () => {
  const box = createMatchbox({
    matches: [match('forge', () => ({ sha: 'invented' }), () => false)],
    recorder: recorder(),
    dependencies: {}
  });
  assert.equal((await box.dispatch('forge', 'commit', { sessionId: 's' })).outcome.status, 'dud');
});
test('missing match is blocked and recorded', async () => {
  const r = recorder();
  const box = createMatchbox({matches: [], recorder:r, dependencies:{}});
  assert.equal((await box.dispatch('absent', null, {sessionId:'s'})).outcome.status, 'blocked');
  assert.equal(r.history.length,2);
});
