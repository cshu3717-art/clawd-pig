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
        const meal = await this.api.prepare(options);
        token = meal && meal.token;
        check();
        if (!meal || !meal.ok) return meal || { ok: false, reason: 'unavailable' };
        const image = await this.api.loadIcon(meal.entry.path);
        check();
        const reached = await this.api.walk(meal.entry, signal);
        check();
        if (!reached) return { ok: false, reason: 'target-unreachable' };
        const animated = await this.api.animate(meal.accepted ? 0 : 1, image, signal);
        check();
        if (!animated) {
          return { ok: false, reason: 'animation-unavailable' };
        }
        check();
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
  if (typeof module !== 'undefined' && module.exports) module.exports = { IconFlow };
  else root.ClawdIconFlow = IconFlow;
})(typeof window !== 'undefined' ? window : globalThis);
