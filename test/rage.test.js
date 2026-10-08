'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RageFlow } = require('../renderer/icon-flow');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
test('怒气逐个等待完成，最多五个，不并发', async () => {
  let running = 0, maximum = 0, steps = 0, ended = 0;
  const flow = new RageFlow({ begin: async () => ({ ok: true, token: 'rage', real: true }), end: async () => { ended++; },
    cancelStep() {}, step: async options => { assert.equal(options.rageToken, 'rage'); steps++; running++; maximum = Math.max(maximum, running); await new Promise(r => setImmediate(r)); running--; return { ok: true }; } });
  const result = flow.run();
  assert.equal((await flow.run()).reason, 'busy');
  assert.deepEqual(await result, { ok: true, count: 5, preview: false });
  assert.equal(maximum, 1); assert.equal(steps, 5); assert.equal(ended, 1); assert.equal(flow.busy, false);
});
test('批次刚申请时取消，迟到的凭据也会释放，绝不开始追逐', async () => {
  const pending = deferred(); let steps = 0, ended = 0;
  const flow = new RageFlow({ begin: () => pending.promise, step: async () => { steps++; }, cancelStep() {}, end: async () => { ended++; } });
  const result = flow.run(); flow.cancel(); pending.resolve({ ok: true, token: 'late', real: true });
  assert.equal((await result).reason, 'cancelled'); assert.equal(steps, 0); assert.equal(ended, 1); assert.equal(flow.busy, false);
});
test('吃第一个时取消，不会启动后续四个', async () => {
  const step = deferred(); let calls = 0;
  const flow = new RageFlow({ begin: async () => ({ ok: true, token: 'one', real: true }), end: async () => {},
    cancelStep: () => step.resolve({ ok: false, reason: 'cancelled' }), step: () => { calls++; return step.promise; } });
  const result = flow.run(); await new Promise(r => setImmediate(r)); flow.cancel();
  assert.equal((await result).reason, 'cancelled'); assert.equal(calls, 1); assert.equal(flow.busy, false);
});
test('候选不足保留已完成数量，预览始终携带 real=false', async () => {
  let count = 0;
  const flow = new RageFlow({ begin: async () => ({ ok: true, token: 'preview', real: false }), end: async () => {}, cancelStep() {},
    step: async options => { assert.equal(options.real, false); return ++count < 3 ? { ok: true } : { ok: false, reason: 'no-candidates' }; } });
  assert.deepEqual(await flow.run(), { ok: false, reason: 'no-candidates', count: 2, preview: true });
});
