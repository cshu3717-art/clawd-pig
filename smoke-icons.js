'use strict';
// 所有读写只落在一次性测试桌面。禁止依赖开发者真实桌面或已有设置。
const { app, BrowserWindow, dialog, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-smoke-'));
const desk = path.join(temp, 'desktop');
const user = path.join(temp, 'profile');
fs.mkdirSync(desk); fs.mkdirSync(user);
process.env.CLAWD_TEST_DESKTOP = desk;
process.env.CLAWD_TEST_USERDATA = user;
for (const name of ['学习软件.lnk', 'B工具.url', 'Chat.lnk', '小猪Clawd.lnk', '照片.jpg', '文档.docx']) fs.writeFileSync(path.join(desk, name), 'fixture:' + name);
fs.mkdirSync(path.join(desk, '文件夹.lnk'));
const headless = app.commandLine.getSwitchValue('ozone-platform') === 'headless';
// Ozone headless 的原生工作区只有 1×1；提供明确的测试显示器。Windows 使用真实屏幕 API。
if (headless) app.whenReady().then(() => {
  const display = { id: 1, scaleFactor: 1, bounds: { x:0, y:0, width:1280, height:800 }, workArea: { x:0, y:0, width:1280, height:800 } };
  screen.getPrimaryDisplay = () => display;
  screen.getDisplayMatching = () => display;
  screen.getDisplayNearestPoint = () => display;
});
const outcomes = [];
const errors = [];
let dialogCount = 0;
dialog.showMessageBox = async () => { dialogCount++; return { response: 1, checkboxChecked: false }; };
app.on('web-contents-created', (_event, contents) => {
  contents.on('did-fail-load', (_ev, code, desc) => errors.push(`${code} ${desc}`));
  contents.on('console-message', (details, oldMessage) => {
    if (details && (details.level === 'error' || details.level === 3)) errors.push(details.message || oldMessage);
  });
});
require('./main');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await wait(60); }
  throw Error('Timed out waiting for state');
}
function check(name, condition) {
  assert.ok(condition, name);
  outcomes.push(name); console.log(`PASS ${outcomes.length}: ${name}`);
}
let pet;
const ev = script => pet.webContents.executeJavaScript(script);
const q = JSON.stringify;
const state = () => ev('window.__clawd.getState()');
const belly = path.join(user, 'belly-storage');
async function startMeal(file, real) {
  await ev(`window.__smokeResult = null; window.iconAPI.requestEat(${q(file)}, ${real}).then(result => { window.__smokeResult = result; }); undefined`);
}
async function endMeal() {
  await until(async () => Boolean(await ev('window.__smokeResult')), 18000);
  return ev('window.__smokeResult');
}
async function run() {
  await app.whenReady();
  await until(async () => {
    pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    return pet && await ev('Boolean(window.__clawd && window.__clawd.getState().sprites)');
  });
  await wait(2400);
  const st = await state();
  check('小猪和吃图标素材就绪', st.sprites && st.iconSheetReady);
  const scan = await ev('window.iconAPI.scan()');
  check('只扫描 .lnk/.url，排除文件夹、文档和自己', scan.entries.length === 3 && !scan.entries.some(e => /小猪|文档|照片|文件夹/.test(e.name)));
  check('每个候选都有测试桌面坐标', scan.entries.every(e => e.target && e.target.source === 'test'));
  check('默认只扫描', (await ev('window.iconAPI.state()')).settings.scanOnly);
  check('不能绕过动画事务直接吃文件', (await ev("window.iconAPI.eat('forged')")).reason === 'invalid-meal');
  await ev('window.__clawd.startWalking()');
  await until(async () => (await state()).movesDone >= 1, 19000);
  const parked = pet.getBounds();
  await wait(600);
  const resting = await state();
  check('自由走动完成后停驻，窗口与脚都保持静止', resting.mvState === 'idle' && resting.frameCol === 0 && pet.getBounds().x === parked.x && pet.getBounds().y === parked.y);
  await ev('window.__clawd.stopWalking()');
  await ev("window.__clawd.runReaction('nose')");
  check('触摸鼻子的表情反应仍可用', (await state()).spriteView === 'expr:surprised');
  await wait(1900);
  await ev("window.iconAPI.setSettings({preferences:{'.lnk':'like','.url':'like'}, cooldownMs:0, dailyLimit:10})");
  const a = path.join(desk, '学习软件.lnk');
  pet.setPosition(600, 400);
  await startMeal(a, false);
  const preview = await endMeal();
  check('扫描模式可走过去预览而不移动文件', preview.ok && preview.preview && fs.existsSync(a));
  await wait(2000);

  await ev('window.iconAPI.setRealMode(true)');
  check('原生确认可开启真实移动', dialogCount === 1);

  pet.setPosition(600, 400);
  await startMeal(a, true);
  await until(async () => (await state()).mvState === 'icon-moving');
  check('行走途中图标仍留在桌面', fs.existsSync(a));
  const before = pet.getBounds();
  const col = (await state()).frameCol;
  await wait(340);
  const during = await state();
  const after = pet.getBounds();
  check('向图标走时窗口发生移动', before.x !== after.x || before.y !== after.y);
  check('向图标走时腿部动画播放', during.frameCol !== col);
  check('忙碌中第二个请求不会并发吃图标', (await ev(`window.iconAPI.requestEat(${q(a)}, true)`)).reason === 'busy');
  await until(async () => /^icon:row0:/.test((await state()).spriteView));
  check('吞吃动画途中图标尚未移走', fs.existsSync(a));
  const eaten = await endMeal();
  check('最后一口后移动进仓库', eaten.ok && !fs.existsSync(a) && fs.existsSync(path.join(belly, eaten.record.storedName)));
  const anchor = (await state()).anchor;
  await wait(2300);
  const idle = await state();
  check('气泡消失后不跳回原位置', Math.abs(idle.anchor.cx-anchor.cx)<=2 && Math.abs(idle.anchor.feet-anchor.feet)<=2);
  check('停下时脚部帧静止', idle.mvState === 'idle' && idle.frameCol === 0);

  const b = path.join(desk, 'B工具.url');
  pet.setPosition(600, 400);
  await startMeal(b, true);
  await until(async () => (await state()).mvState === 'icon-moving');
  await ev("document.getElementById('stage').dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,pointerType:'mouse',button:0,clientX:50,clientY:50})); document.getElementById('stage').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})); undefined");
  check('走路时取消不吃图标', (await endMeal()).reason === 'cancelled' && fs.existsSync(b));
  await startMeal(b, true);
  await until(async () => /^icon:row0:/.test((await state()).spriteView));
  await ev('window.iconAPI.setSettings({scanOnly:true})');
  check('动画中关闭真实移动也能及时停止', (await endMeal()).reason === 'cancelled' && fs.existsSync(b));

  fs.writeFileSync(a, 'new shortcut must not be overwritten');
  const restored = await ev(`window.iconAPI.harvest(${q(eaten.record.id)})`);
  check('同名恢复不覆盖原有文件', restored.ok && restored.restoredTo !== a && fs.readFileSync(a,'utf8') === 'new shortcut must not be overwritten');
  await ev('window.iconAPI.setSettings({scanOnly:false})');
  const again = await ev(`window.iconAPI.prepare({path:${q(b)},real:true,hunger:100})`);
  fs.mkdirSync(path.join(belly, 'manifest.json.tmp'));
  const rejected = await ev(`window.iconAPI.eat(${q(again.token)})`);
  check('仓库记录写入失败时保留原文件', rejected.reason === 'storage-write-failed' && fs.existsSync(b));
  fs.rmdirSync(path.join(belly, 'manifest.json.tmp'));
  await ev('window.iconAPI.release()');
  const meal = await ev(`window.iconAPI.prepare({path:${q(b)},real:true,hunger:100})`);
  const moved = await ev(`window.iconAPI.eat(${q(meal.token)})`);
  check('合法事务保存可恢复记录', moved.ok && moved.record.desktopPos);
  fs.writeFileSync(path.join(belly, 'manifest.json'), '{broken');
  const recovered = await ev('window.iconAPI.state()');
  check('损坏清单可从仓库重建种子', recovered.stored.some(e => e.name === 'B工具.url'));
  const all = await ev('window.iconAPI.restoreAll()');
  check('一键恢复全部保留所有快捷方式', all.restored === 1 && fs.existsSync(b));
  check('文档和照片完全未改动', fs.readFileSync(path.join(desk,'文档.docx'),'utf8') === 'fixture:文档.docx' && fs.readFileSync(path.join(desk,'照片.jpg'),'utf8') === 'fixture:照片.jpg');
  await ev('window.iconAPI.setSettings({scanOnly:true})');
  if (headless) { pet.setSize(460, 620); await pet.loadURL('app://pet/panel.html'); }
  else await ev('window.iconAPI.openPanel()');
  let panel;
  await until(async () => {
    panel = headless ? pet : BrowserWindow.getAllWindows().find(w => w !== pet);
    return panel && await panel.webContents.executeJavaScript("document.getElementById('mode') && document.getElementById('mode').textContent === '只预览'");
  });
  const pv = script => panel.webContents.executeJavaScript(script);
  await pv("document.getElementById('btnScan').click()");
  await until(() => pv("document.querySelectorAll('#candidates .item').length >= 3"));
  check('未开启时吃图标按钮禁用', await pv("[...document.querySelectorAll('#candidates button')].filter(b=>b.textContent==='走过去吃').every(b=>b.disabled)"));
  await pv("document.getElementById('scanOnly').click()");
  await until(() => pv("document.getElementById('mode').textContent === '真实移动已开启' && !document.querySelector('#candidates .item button:last-child').disabled"));
  check('原生确认后开关与已扫描按钮同步更新', dialogCount >= 1);

  check('页面无加载或运行错误', errors.length === 0);
  fs.mkdirSync('test-results', {recursive:true});
  fs.writeFileSync('test-results/panel.png', (await panel.webContents.capturePage()).toPNG());
  fs.writeFileSync('test-results/electron-smoke.json', JSON.stringify({ passed: outcomes.length, tests: outcomes, platform: process.platform, virtualDisplay: headless, electron: process.versions.electron }, null, 2));
  console.log(`SUMMARY ${outcomes.length}/${outcomes.length} passed`);
  app.exit(0);
}
run().catch(async error => { console.error(error.stack); try { console.error('STATE', JSON.stringify(await state())); } catch {} console.error('Renderer errors:', errors); console.error('Temporary fixture:',temp); app.exit(1); });
setTimeout(() => { console.error('TIMEOUT'); app.exit(2); }, 100000);
