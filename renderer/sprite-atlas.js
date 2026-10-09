(function (root) {
  'use strict';
  // 生成图的个别道具/脚尖跨过网格线。只整理内存中的画布，原始 PNG 保持只读。
  function prepare(source, kind) {
    const output = document.createElement('canvas');
    output.width = source.width;
    if (kind === 'icon') {
      const oldHeight = source.height / 3, oldWidth = source.width / 8;
      const extra = Math.round(oldHeight / 16);
      const height = oldHeight + extra, width = oldWidth + extra;
      output.width = width * 8;
      output.height = height * 3;
      const ctx = output.getContext('2d');
      for (let row = 0; row < 3; row++) {
        // 第二排先跳过第一排越界的脚尖；第一排则保留这些脚尖。
        const skip = row === 1 ? extra : 0;
        const y = row * oldHeight + skip;
        const count = Math.min(height - skip, source.height - y);
        for (let col = 0; col < 8; col++) {
          // 前两排的快捷方式也有越过列边界的部分。最后一排身体靠左，保留完整。
          const left = row < 2 && col > 0 ? extra : 0;
          const x = col * oldWidth + left;
          const across = Math.min(oldWidth + (row < 2 ? extra : 0) - left, source.width - x);
          ctx.drawImage(source, x, y, across, count, col * width + left, row * height + skip, across, count);
        }
      }
    } else {
      output.height = source.height;
      const ctx = output.getContext('2d'); ctx.drawImage(source, 0, 0);
      if (kind === 'action') ctx.clearRect(0, source.height / 2, source.width, Math.ceil(source.height / 4 * (16 / 271)));
    }
    return output;
  }
  root.ClawdSpriteAtlas = { prepare };
})(typeof window !== 'undefined' ? window : globalThis);
