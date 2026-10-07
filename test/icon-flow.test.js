'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IconFlow } = require('../renderer/icon-flow');
const { attachTargets } = require('../lib/desktop-targets');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const calls = [];
  const record = (name, result) => async () => { calls.push(name); return result; };
  const api = {
    pause: record('pause'), prepare: record('prepare', { ok: true, token: 'one', entry: { path: 'A.lnk' }, accepted: true, real: true }),
    loadIcon: record('image', null), walk: record('walk', true), animate: record('animate', true),
    commit: record('commit', { ok: true }), release: record('release'), resume: () => calls.push('resume'), ...overrides,
  };
  return { flow: new IconFlow(api), calls };
}
test('只有走到并完整播放动画后才能移动文件', async () => {
  const animation = deferred();
  const { flow, calls } = fixture({ animate: () => animation.promise });
  const result = flow.run({ real: true });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['pause', 'prepare', 'image', 'walk']);
  animation.resolve(true);
  assert.equal((await result).ok, true);
  assert.deepEqual(calls.slice(-3), ['commit', 'release', 'resume']);
  assert.equal(flow.busy, false);
});
test('预览不移动文件', async () => {
  const { flow, calls } = fixture({ prepare: async () => ({ ok: true, token: 'one', real: false, accepted: true, entry: { path: 'A.lnk' } }) });
  assert.equal((await flow.run({ real: false })).preview, true);
  assert.ok(!calls.includes('commit'));
});
for (const stage of ['prepare', 'walk', 'animate']) {
  test(`在 ${stage} 阶段取消，迟到的回调也不能吃掉文件`, async () => {
    const pending = deferred();
    const { flow, calls } = fixture({ [stage]: () => pending.promise });
    const result = flow.run({ real: true });
    await new Promise(r => setImmediate(r));
    assert.equal((await flow.run({ real: true })).reason, 'busy');
    flow.cancel();
    pending.resolve(stage === 'prepare' ? { ok: true, token: 'one', real: true, accepted: true, entry: { path: 'A.lnk' } } : false);
    assert.equal((await result).reason, 'cancelled');
    assert.ok(!calls.includes('commit'));
    assert.equal(flow.busy, false);
  });
}
for (const [stage, reason] of [['walk', 'target-unreachable'], ['animate', 'animation-unavailable']]) {
  test(`${stage} 失败时保留桌面文件`, async () => {
    const { flow, calls } = fixture({ [stage]: async () => false });
    assert.equal((await flow.run({ real: true })).reason, reason);
    assert.ok(!calls.includes('commit'));
  });
}
test('嫌弃动画不进入存储操作', async () => {
  let row;
  const { flow, calls } = fixture({ prepare: async () => ({ ok: true, token: 'one', real: true, accepted: false, entry: { path: 'A.lnk' } }), animate: async n => { row = n; return true; } });
  assert.equal((await flow.run({ real: true })).reason, 'not-hungry');
  assert.equal(row, 1);
  assert.ok(!calls.includes('commit'));
});
test('异常后释放占用，后续操作仍可开始', async () => {
  const { flow, calls } = fixture({ walk: async () => { throw Error('failed'); } });
  assert.equal((await flow.run({})).reason, 'failed');
  assert.equal(flow.busy, false);
  assert.deepEqual(calls.slice(-2), ['release', 'resume']);
});
const screen = { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }), screenToDipPoint: p => ({ x: p.x / 2, y: p.y / 2 }) };
test('中文名称及隐藏扩展名匹配，物理像素转 DIP', () => {
  const [entry] = attachTargets([{ name: '学习软件.lnk' }], [{ name: '学习软件', x: -400, y: 80, width: 100, height: 100 }], screen);
  assert.deepEqual(entry.target, { x: -175, y: 65, source: 'desktop' });
});
test('重复显示名不猜测真实目标', () => {
  const entries = attachTargets([{ name: '学习.lnk' }, { name: '学习.url' }], [{ name: '学习', x: 0, y: 0, width: 80, height: 80 }], screen);
  assert.ok(entries.every(e => e.target.source === 'estimated'));
});
test('桌面未定位只允许估算预览，不冒充真实位置', () => {
  assert.equal(attachTargets([{ name: 'A.lnk' }], [], screen)[0].target.source, 'estimated');
  assert.equal(attachTargets([{ name: 'A.lnk' }], [], screen, true)[0].target.source, 'test');
});
