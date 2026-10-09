(function (root) {
  'use strict';
  // 装饰画在精灵同一变换中，随脚步、朝向与尺寸变化。保留原本的小猪身体。
  function draw(ctx, outfit, box, part) {
    if (!outfit || !box) return;
    const { x, y, w, h } = box;
    const unit = Math.max(1, Math.round(w / 38));
    const block = (rx, ry, rw, rh, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x + rx * w), Math.round(y + ry * h), Math.max(unit, Math.round(rw * w)), Math.max(unit, Math.round(rh * h)));
    };
    const hat = (color, rim) => {
      if (part === 'scarf') return;
      block(.29, -.015, .42, .075, rim);
      block(.25, .035, .50, .09, color);
      block(.18, .105, .64, .035, rim);
      block(.32, .04, .09, .025, '#fff4cf');
    };
    const scarf = (color, light) => {
      if (part === 'hat') return;
      block(.15, .68, .70, .085, color);
      block(.20, .69, .55, .025, light);
      block(.67, .73, .13, .18, color);
      block(.68, .85, .11, .025, light);
    };
    if (outfit === 'rain') {
      hat('#ffe483', '#cd9c3e');
      scarf('#73c7d4', '#c5edf0');
    } else if (outfit === 'snow' || outfit === 'cold') {
      hat('#cf6380', '#984864');
      if (part !== 'scarf') block(.44, -.065, .13, .065, '#fff6e5');
      scarf('#cf6380', '#ffcedc');
    } else if (outfit === 'sun') {
      hat('#f1d39b', '#b58954');
      if (part !== 'scarf') block(.26, .087, .48, .025, '#ce7365');
    } else if (outfit === 'wind') {
      scarf('#77ab94', '#c3ddbb');
    } else if (outfit === 'night') {
      hat('#9d9ac8', '#6e6894');
      if (part !== 'scarf') {
        block(.64, .035, .15, .055, '#9d9ac8');
        block(.77, .05, .07, .055, '#fff1bc');
      }
    } else if (outfit === 'cloud') {
      scarf('#94bac9', '#d6e7ef');
    }
  }
  // 各动作的身体中心/宽高/倾角，坐标来自原始格子，不把花盆、画架算进身体。
  // actions 参考格为 362×271，icon 补齐越界边缘后为 272×272；按实际尺寸换算。
  const anchors = {
    action: [
      [[146,190,174,152,0], [146,180,173,152,-12], [145,181,173,152,-12], [117,190,181,152,0]],
      [[134,180,180,152,0], [160,162,180,152,20], [130,162,180,152,20], [126,180,180,152,0]],
      [[122,183,158,150,0], [126,180,158,150,-5], [126,180,158,150,-5], [95,184,158,150,0]],
      [[173,140,186,165,0], [173,140,186,165,0], [174,140,186,165,0], [179,140,186,165,0]],
    ],
    icon: [
      [[112,198,142,134,0], [124,198,150,134,0], [124,197,148,134,0], [126,198,140,134,0], [129,196,140,134,0], [108,195,138,134,0], [127,197,140,134,0], [123,196,140,134,0]],
      [[111,155,140,128,0], [113,155,135,128,0], [117,154,141,128,0], [113,149,139,128,-14], [108,154,140,128,0], [120,159,146,118,0], [124,157,136,126,0], [116,155,146,128,0]],
      [[117,94,132,130,0], [109,95,137,128,-6], [102,92,132,130,0], [94,105,136,118,0], [78,92,126,130,0], [83,92,127,130,0], [72,92,131,130,0], [90,92,138,130,0]],
    ],
  };
  function anchor(kind, row, col, width, height, fallback) {
    const point = anchors[kind]?.[row]?.[col];
    if (!point) return fallback ? { ...fallback, angle: 0 } : null;
    const sx = width / (kind === 'action' ? 362 : 272);
    const sy = height / (kind === 'action' ? 271 : 272);
    const [cx, cy, w, h, angle] = point;
    return { x: (cx - w / 2) * sx, y: (cy - h / 2) * sy, w: w * sx, h: h * sy, angle };
  }
  const frameMasks = new WeakMap();
  const layers = new WeakMap();
  const outfits = new Set(['rain', 'snow', 'cold', 'sun', 'wind', 'night', 'cloud']);
  function canvas(width, height) {
    const cv = document.createElement('canvas'); cv.width = width; cv.height = height; return cv;
  }
  function skinMask(source, frame, key) {
    if (!frameMasks.has(source)) frameMasks.set(source, new Map());
    const cache = frameMasks.get(source);
    if (cache.has(key)) return cache.get(key);
    const cv = canvas(frame.w, frame.h);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    const pixels = ctx.getImageData(0, 0, frame.w, frame.h);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const p = pixels.data, r = p[i], g = p[i + 1], b = p[i + 2];
      // 只让围巾覆盖暖橘色身体。手机、花洒、画笔和透明区域保持在前面。
      if (!(r > 150 && g > 65 && b > 40 && r - g > 30 && g - b >= 10 && b > g * .55)) p[i + 3] = 0;
    }
    ctx.putImageData(pixels, 0, 0); cache.set(key, cv); return cv;
  }
  function layer(source, frame, outfit, kind, row, col, fallback) {
    if (!source || !outfits.has(outfit)) return null;
    const box = anchor(kind, row, col, frame.w, frame.h, fallback);
    if (!box) return null;
    if (!layers.has(source)) layers.set(source, new Map());
    const cache = layers.get(source);
    const frameKey = `${kind}:${row}:${col}`;
    const key = `${frameKey}:${outfit}`;
    if (cache.has(key)) return cache.get(key);
    const pad = Math.ceil(Math.max(frame.w, frame.h) * .08);
    const cv = canvas(frame.w + pad * 2, frame.h + pad * 2);
    const ctx = cv.getContext('2d');
    const transformed = part => {
      ctx.save(); ctx.translate(pad + box.x + box.w / 2, pad + box.y + box.h / 2);
      ctx.rotate(box.angle * Math.PI / 180);
      draw(ctx, outfit, { x: -box.w / 2, y: -box.h / 2, w: box.w, h: box.h }, part);
      ctx.restore();
    };
    transformed('scarf');
    // destination-in 只裁围巾，帽子可以自然伸出头顶；掩码与动画格同坐标。
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(skinMask(source, frame, frameKey), pad, pad);
    ctx.globalCompositeOperation = 'source-over';
    transformed('hat');
    const result = { canvas: cv, pad, box };
    // 每张素材最多缓存 48 个换装格，避免反复换天气时无限增加内存。
    if (cache.size >= 48) cache.delete(cache.keys().next().value);
    cache.set(key, result); return result;
  }
  root.ClawdWeatherOutfit = { draw, anchor, layer };
  if (typeof module !== 'undefined') module.exports = root.ClawdWeatherOutfit;
})(typeof window !== 'undefined' ? window : globalThis);
