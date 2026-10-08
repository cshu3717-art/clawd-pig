(function (root) {
  'use strict';
  // 装饰画在精灵同一变换中，随脚步、朝向与尺寸变化。保留原本的小猪身体。
  function draw(ctx, outfit, box) {
    if (!outfit || !box) return;
    const { x, y, w, h } = box;
    const unit = Math.max(1, Math.round(w / 38));
    const block = (rx, ry, rw, rh, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x + rx * w), Math.round(y + ry * h), Math.max(unit, Math.round(rw * w)), Math.max(unit, Math.round(rh * h)));
    };
    const hat = (color, rim) => {
      block(.29, -.015, .42, .075, rim);
      block(.25, .035, .50, .09, color);
      block(.18, .105, .64, .035, rim);
      block(.32, .04, .09, .025, '#fff4cf');
    };
    const scarf = (color, light) => {
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
      block(.44, -.065, .13, .065, '#fff6e5');
      scarf('#cf6380', '#ffcedc');
    } else if (outfit === 'sun') {
      hat('#f1d39b', '#b58954');
      block(.26, .087, .48, .025, '#ce7365');
    } else if (outfit === 'wind') {
      scarf('#77ab94', '#c3ddbb');
    } else if (outfit === 'night') {
      hat('#9d9ac8', '#6e6894');
      block(.64, .035, .15, .055, '#9d9ac8');
      block(.77, .05, .07, .055, '#fff1bc');
    } else if (outfit === 'cloud') {
      scarf('#94bac9', '#d6e7ef');
    }
  }
  root.ClawdWeatherOutfit = { draw };
})(typeof window !== 'undefined' ? window : globalThis);
