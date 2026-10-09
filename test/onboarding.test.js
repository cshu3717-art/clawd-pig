'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Onboarding } = require('../lib/onboarding');

test('fresh setup opens and can resume the last saved step', () => {
  let saved;
  const first = new Onboarding({ save: state => { saved = state; } });
  assert.equal(first.shouldOpen(), true);
  assert.equal(first.progress(1).ok, true);
  const resumed = new Onboarding({ initial: saved, save() {} });
  assert.equal(resumed.shouldOpen(), true);
  assert.equal(resumed.state().step, 1);
});
test('finishing or postponing suppresses startup, including after manual replay', () => {
  for (const action of ['finish', 'later']) {
    let saved;
    const guide = new Onboarding({ save: state => { saved = state; } });
    assert.equal(guide[action]().ok, true);
    assert.equal(new Onboarding({ initial: saved, save() {} }).shouldOpen(), false);
    guide.progress(0);
    assert.equal(new Onboarding({ initial: saved, save() {} }).shouldOpen(), false);
  }
});
test('save failure does not report success or discard resumable progress', () => {
  const guide = new Onboarding({ initial: { step: 1 }, save() { throw Error('disk full'); } });
  for (const action of [() => guide.progress(2), () => guide.finish(), () => guide.later()]) {
    assert.equal(action().reason, 'save-failed');
    assert.deepEqual(guide.state(), { version: 1, status: 'pending', step: 1 });
  }
});
test('malformed persisted data and invalid step requests stay bounded', () => {
  for (const initial of [null, 'bad', { status: 'unknown', step: Infinity }, { step: -3 }]) {
    const guide = new Onboarding({ initial, save() {} });
    assert.deepEqual(guide.state(), { version: 1, status: 'pending', step: 0 });
    for (const step of [-1, 3, '1', 1.5]) assert.equal(guide.progress(step).reason, 'bad-step');
  }
});
