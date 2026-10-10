'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitWindowBounds: fit } = require('../lib/window-layout');

test('副屏在主屏左上方时保留合法负坐标，不强行送回主屏', () => {
  const bounds = { x: -1100, y: -180, width: 180, height: 220 };
  assert.deepEqual(fit(bounds, { x: -1280, y: -240, width: 1280, height: 960 }), bounds);
});
test('断开的副屏位置恢复到剩余工作区，同时避开顶部与左侧任务栏', () => {
  assert.deepEqual(fit({ x: -1200, y: -300, width: 180, height: 220 },
    { x: 64, y: 32, width: 1216, height: 728 }), { x: 64, y: 32, width: 180, height: 220 });
});
test('125% 与 150% 缩放后的 DIP 工作区只约束位置，不重复缩放窗口', () => {
  for (const scale of [1.25, 1.5]) {
    const area = { x: 0, y: 0, width: 1920 / scale, height: 1080 / scale - 40 };
    const result = fit({ x: 1700, y: 900, width: 180, height: 220 }, area);
    assert.equal(result.width, 180); assert.equal(result.height, 220);
    assert.equal(result.x + result.width, area.width);
    assert.equal(result.y + result.height, area.height);
  }
});
test('正常范围内的气泡或动作扩展不改变窗口位置', () => {
  const bounds = { x: 200, y: 100, width: 480, height: 260 };
  assert.deepEqual(fit(bounds, { x: 0, y: 0, width: 1280, height: 760 }, { x: 220, y: 245 }), bounds);
});
test('装饰画布比小工作区更宽时优先保留小猪锚点，而非透明区域', () => {
  const area = { x: -300, y: 40, width: 240, height: 180 };
  const anchor = { x: 480, y: 260 };
  const result = fit({ x: 2000, y: 1500, width: 960, height: 300 }, area, anchor);
  assert.equal(result.x + anchor.x, -140);
  assert.equal(result.y + anchor.y, 208);
  assert.equal(result.width, 960); assert.equal(result.height, 300);
});
test('面板放不下时保留标题栏，避免最小高度把整个窗口推到屏幕上方', () => {
  assert.deepEqual(fit({ x: 1200, y: 800, width: 460, height: 620 },
    { x: 10, y: 30, width: 400, height: 400 }), { x: 10, y: 30, width: 460, height: 620 });
});
test('短暂不可用的工作区不写入无效坐标，重复恢复也不会漂移', () => {
  const bounds = { x: -900, y: 1000, width: 200, height: 200 };
  assert.deepEqual(fit(bounds, { x: 0, y: 0, width: 0, height: 0 }), bounds);
  const area = { x: 0, y: 0, width: 1000, height: 700 };
  const once = fit(bounds, area);
  assert.deepEqual(fit(once, area), once);
});
