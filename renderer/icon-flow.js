(function (root) {
  'use strict';

  // 一个入口负责走近、完整播放、吞下、收尾。文件移动必须排在动画之后。
  class IconFlow {
    constructor(api) { this.api = api; this.active = null; }
    get busy() { return this.active !== null; }
    cancel() { if (this.active) this.active.abort(); }

    async run(options) {
      if (this.busy) return { ok: false, reason: 'busy' };
      const controller = new AbortController();
      const signal = controller.signal;
      this.active = controller;
      let token = null;
      const check = () => { if (signal.aborted) throw new Error('cancelled'); };
      try {
        await this.api.pause();
        check();
        const planting = options.kind === 'plant';
        const meal = await (planting ? this.api.preparePlant(options.token) : this.api.prepare(options));
        token = meal && meal.token;
        check();
        if (!meal || !meal.ok) return meal || { ok: false, reason: 'unavailable' };
        const image = planting ? null : await this.api.loadIcon(meal.entry.path);
        check();
        const reached = planting || await this.api.walk(meal.entry, signal);
        check();
        if (!reached) return { ok: false, reason: 'target-unreachable' };
        const animated = await this.api.animate(planting ? 2 : meal.accepted ? 0 : 1, image, signal);
        check();
        if (!animated) {
          return { ok: false, reason: 'animation-unavailable' };
        }
        check();
        if (planting) return await this.api.commitPlant(token);
        if (!meal.accepted) return { ok: false, reason: 'not-hungry', name: meal.entry.name };
        if (!meal.real) return { ok: true, preview: true, name: meal.entry.name };
        return await this.api.commit(token);
      } catch (error) {
        return { ok: false, reason: signal.aborted ? 'cancelled' : 'failed' };
      } finally {
        try { await this.api.release(token); }
        catch { /* 窗口关闭时也要释放本地占用，避免未处理的 Promise 拒绝。 */ }
        finally {
          if (this.active === controller) this.active = null;
          this.api.resume();
        }
      }
    }
  }
  class RageFlow {
    constructor(api) { this.api = api; this.active = null; }
    get busy() { return this.active !== null; }
    cancel() {
      if (!this.active) return;
      this.active.cancelled = true;
      this.api.cancelStep();
      if (this.active.token) Promise.resolve(this.api.end(this.active.token)).catch(() => {});
    }
    async run() {
      if (this.busy) return { ok: false, reason: 'busy', count: 0 };
      const task = { cancelled: false, token: null };
      this.active = task;
      let count = 0, preview = true;
      try {
        const batch = await this.api.begin();
        task.token = batch && batch.token;
        if (!batch || !batch.ok) return { ...batch, count };
        preview = !batch.real;
        for (let index = 0; index < 5; index++) {
          if (task.cancelled) return { ok: false, reason: 'cancelled', count, preview };
          const result = await this.api.step({ rageToken: task.token, real: batch.real });
          if (!result.ok) return { ...result, count, preview };
          count++;
          if (this.api.progress) this.api.progress(count, preview);
        }
        return { ok: true, count, preview };
      } catch { return { ok: false, reason: task.cancelled ? 'cancelled' : 'failed', count, preview }; }
      finally {
        try { if (task.token) await this.api.end(task.token); } catch { /* 主窗口退出时清理连接可能已关闭 */ }
        finally { if (this.active === task) this.active = null; }
      }
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { IconFlow, RageFlow };
  else { root.ClawdIconFlow = IconFlow; root.ClawdRageFlow = RageFlow; }
})(typeof window !== 'undefined' ? window : globalThis);
