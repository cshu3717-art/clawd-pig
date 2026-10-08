'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
assert.equal(pkg.version, lock.version, 'lockfile version differs');
assert.equal(pkg.version, lock.packages[''].version, 'lockfile root version differs');
for (const file of ['lib/weather.js', 'renderer/icon-flow.js', 'renderer/weather-outfit.js', 'renderer/weather-panel.js']) {
  assert.ok(fs.statSync(file).size > 0, `missing ${file}`);
  execFileSync(process.execPath, ['--check', file]);
}
for (const file of ['main.js', 'preload.js', 'lib/desktop-targets.js', 'renderer/index.html', 'renderer/icon-flow.js', 'renderer/renderer.js', 'assets/clawd-pig-core-v1.png', 'assets/clawd-pig-actions-v1.png', 'assets/sprites-manifest.json', '小猪Clawd-吃图标与种植动作-v1.png']) {
  assert.ok(fs.statSync(file).size > 0, `missing ${file}`);
}
for (const pattern of ['main.js', 'preload.js', 'lib/**/*', 'renderer/**/*', 'assets/**/*', '小猪Clawd-*.png']) assert.ok(pkg.build.files.includes(pattern), `package excludes ${pattern}`);
assert.deepEqual(pkg.build.win.target.map(x => x.target).sort(), ['nsis', 'portable']);
console.log('Package manifest, lockfile, runtime modules, sprites and Windows targets verified.');
