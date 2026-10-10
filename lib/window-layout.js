'use strict';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Electron 窗口、工作区和锚点均使用 DIP；负坐标是合法的副屏位置。
// 放得下时保留窗口大小；放不下时优先露出小猪身体，普通窗口露出标题栏。
function fitWindowBounds(bounds, area, anchor) {
  if (!area || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(area[key]))
      || area.width <= 0 || area.height <= 0) return { ...bounds };
  function axis(position, size, start, extent, offset, before, after) {
    if (size <= extent) return clamp(position, start, start + extent - size);
    if (!Number.isFinite(offset)) return start;
    return clamp(position, start + Math.min(before, extent / 2) - offset,
      start + extent - Math.min(after, extent / 2) - offset);
  }
  return {
    ...bounds,
    x: Math.round(axis(bounds.x, bounds.width, area.x, area.width, anchor?.x, 80, 80)),
    y: Math.round(axis(bounds.y, bounds.height, area.y, area.height, anchor?.y, 120, 12)),
  };
}

module.exports = { fitWindowBounds };
