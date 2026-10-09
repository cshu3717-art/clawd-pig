'use strict';
// 在 Electron 页面中执行，使用真实 PNG 与正式换装模块，不另写一套绘制实现。
module.exports = async function outfitGallery() {
  const payload = await window.petAPI.getAssets();
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const load = async url => {
    const image = new Image(); image.src = url; await image.decode();
    const c = cv(image.naturalWidth, image.naturalHeight); c.getContext('2d').drawImage(image, 0, 0); return c;
  };
  const all = [], pngs = {};
  let bodyContact = true, originalUntouched = true, protectedPixels = 0, coveredProps = 0, atlasClean = true;
  for (const [kind, url, cols, rows] of [['action', payload.spriteActions, 4, 4], ['icon', payload.iconSheet, 8, 3]]) {
    const raw = await load(url), rawBefore = raw.toDataURL();
    const source = window.ClawdSpriteAtlas.prepare(raw, kind), before = source.toDataURL();
    const alphaCount = (y, height) => {
      const data = source.getContext('2d').getImageData(0, y, source.width, height).data;
      let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count++; return count;
    };
    if (kind === 'icon') atlasClean = atlasClean && alphaCount(256,16) > 0 && alphaCount(272,16) === 0;
    else atlasClean = atlasClean && alphaCount(source.height / 2,16) === 0;
    const w = source.width / cols, h = source.height / rows;
    const tileW = kind === 'action' ? 270 : 200, tileH = kind === 'action' ? 228 : 228;
    const gallery = cv(tileW * cols, tileH * rows);
    const g = gallery.getContext('2d'); g.fillStyle = '#f7e7da'; g.fillRect(0,0,gallery.width,gallery.height);
    g.imageSmoothingEnabled = false;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const frame = { x: col * w, y: row * h, w, h };
      const original = source.getContext('2d').getImageData(frame.x, frame.y, w, h).data;
      for (const outfit of ['rain','snow','cold','sun','wind','night','cloud']) {
        const layer = window.ClawdWeatherOutfit.layer(source, frame, outfit, kind, row, col);
        if (!layer) throw Error(`missing ${kind}:${row}:${col}:${outfit}`);
        const pixels = layer.canvas.getContext('2d').getImageData(layer.pad, layer.pad, w, h).data;
        let changed = 0, onBody = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 8) { changed++; if (original[i + 3] > 8) onBody++; }
          // 对实际花洒/手机的像素作回归，而不是重复生产代码的皮肤筛选条件。
          if (outfit === 'wind' && kind === 'action' && original[i + 3] > 200) {
            const blueCan = row === 1 && original[i + 2] > original[i] + 40 && original[i + 1] > 65;
            const phone = row === 3 && i / 4 / w > 125 && original[i] < 60 && original[i + 1] < 60 && original[i + 2] < 60;
            if (blueCan || phone) { protectedPixels++; if (pixels[i + 3]) coveredProps++; }
          }
        }
        all.push({ kind, row, col, outfit, pixels: changed });
        if (changed < 25 || onBody < 15) bodyContact = false;
      }
      const layer = window.ClawdWeatherOutfit.layer(source, frame, kind === 'action' ? 'snow' : 'rain', kind, row, col);
      const scale = (tileW - 22) / w, x = col * tileW + 11, y = row * tileH + 22;
      g.fillStyle = '#694437'; g.font = '12px sans-serif'; g.fillText(`${kind} ${row + 1}.${col + 1}`, x, y - 6);
      g.drawImage(source, frame.x, frame.y, w, h, x, y, w * scale, h * scale);
      g.drawImage(layer.canvas, x - layer.pad * scale, y - layer.pad * scale, layer.canvas.width * scale, layer.canvas.height * scale);
    }
    originalUntouched = originalUntouched && before === source.toDataURL() && rawBefore === raw.toDataURL();
    pngs[kind] = gallery.toDataURL();
  }
  return { frameOutfits: all.length, bodyContact, originalUntouched, atlasClean, protectedPixels, coveredProps, pngs };
};
