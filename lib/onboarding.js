'use strict';

// 引导独立保存，不用完成天气查询来冒充“用户已完成设置”。
class Onboarding {
  constructor({ initial, save }) {
    const value = initial && typeof initial === 'object' ? initial : {};
    this.value = {
      version: 1,
      status: ['done', 'later'].includes(value.status) ? value.status : 'pending',
      step: Number.isInteger(value.step) ? Math.max(0, Math.min(2, value.step)) : 0,
    };
    this.save = save;
  }
  state() { return { ...this.value }; }
  shouldOpen() { return this.value.status === 'pending'; }
  update(change) {
    const next = { ...this.value, ...change };
    try { this.save(next); } catch { return { ok: false, reason: 'save-failed', state: this.state() }; }
    this.value = next;
    return { ok: true, state: this.state() };
  }
  progress(step) {
    if (!Number.isInteger(step) || step < 0 || step > 2) return { ok: false, reason: 'bad-step' };
    return this.update({ step });
  }
  finish() { return this.update({ status: 'done', step: 2 }); }
  later() { return this.update({ status: 'later' }); }
}
module.exports = { Onboarding };
