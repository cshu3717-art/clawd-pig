'use strict';
// 首次引导的真实页面/IPC 验证。独立临时桌面，不读取用户配置。
const { app, BrowserWindow, screen, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Onboarding } = require('./lib/onboarding');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-setup-'));
const user = path.join(temp, 'profile');
const desk = path.join(temp, 'desktop');
fs.mkdirSync(user); fs.mkdirSync(desk);
process.env.CLAWD_TEST_DESKTOP = desk;
process.env.CLAWD_TEST_USERDATA = user;
const headless = app.commandLine.getSwitchValue('ozone-platform') === 'headless';
const setupFile = path.join(user, 'onboarding.json');
// Ozone headless 不支持本应用的两个原生窗口；同一窗口检查引导页面。
// Windows 不写这个夹具，直接验证第一次启动自动弹出第二个窗口。
if (headless) {
  fs.writeFileSync(setupFile, JSON.stringify({ status: 'later', step: 0 }));
  app.whenReady().then(() => {
    const display = { id: 1, scaleFactor: 1, bounds: { x:0,y:0,width:1280,height:800 }, workArea: { x:0,y:0,width:1280,height:800 } };
    screen.getPrimaryDisplay = () => display; screen.getDisplayMatching = () => display; screen.getDisplayNearestPoint = () => display;
  });
}
let queries = 0;
net.fetch = async url => {
  if (new URL(url).hostname === 'geocoding-api.open-meteo.com') return new Response(JSON.stringify({ results: [
    { id:1792947, name:'太原', admin1:'山西', country:'中国', latitude:37.87, longitude:112.55 },
  ] }));
  queries++; throw Error('offline fixture');
};
const errors = [], tests = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('did-fail-load', (_ev, code, desc) => errors.push(`${code} ${desc}`));
  contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
});
require('./main');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await wait(60); }
  throw Error('Timed out waiting for setup');
}
function check(name, condition) { assert.ok(condition, name); tests.push(name); console.log(`PASS ${tests.length}: ${name}`); }
let pet, panel;
const ev = script => pet.webContents.executeJavaScript(script);
const pv = script => panel.webContents.executeJavaScript(script);
const click = id => pv(`document.getElementById(${JSON.stringify(id)}).click()`);
const readState = () => JSON.parse(fs.readFileSync(setupFile, 'utf8'));
async function waitForPage() {
  await until(() => pv("document.body.classList.contains('in-setup') && document.getElementById('setupTitle').textContent.includes('城市')"));
}
async function reopen() {
  if (headless) { await click('btnSetupOpen'); }
  else {
    await ev('window.setupAPI.open()');
    await until(() => { panel = BrowserWindow.getAllWindows().find(w => w !== pet); return !!panel; });
  }
  await waitForPage();
}
async function leave() {
  await until(() => headless ? pv("!document.body.classList.contains('in-setup')") : panel.isDestroyed());
}
async function run() {
  await app.whenReady();
  await until(async () => {
    pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    return pet && await ev('Boolean(window.__clawd?.getState().sprites)');
  });
  if (headless) { panel = pet; pet.setSize(460,620); await pet.loadURL('app://pet/panel.html#setup'); }
  else {
    await until(() => { panel = BrowserWindow.getAllWindows().find(w => w !== pet); return !!panel; });
    check('首次启动自动打开独立引导，桌宠仍存在', BrowserWindow.getAllWindows().length === 2);
  }
  await waitForPage();
  check('没有城市时下一步禁用，跳过仍可用', await pv("document.getElementById('btnSetupNext').disabled && !document.getElementById('btnSetupSkip').disabled"));
  check('未选城市不发天气请求', queries === 0);
  check('引导底部按钮在窗口内可见', await pv("document.getElementById('btnSetupNext').getBoundingClientRect().bottom <= innerHeight"));
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/setup-city.png', (await panel.webContents.capturePage()).toPNG());
  await click('btnSetupSkip');
  await until(() => pv("!document.getElementById('setupMeet').hidden"));
  check('可跳过天气，并把天气查询保持关闭', !(await pv('window.weatherAPI.state()')).enabled && readState().step === 1);
  await click('btnSetupBack');
  await until(() => pv("!document.getElementById('weatherCard').hidden"));
  await pv("document.getElementById('cityQuery').value='太原'"); await click('btnCitySearch');
  await until(() => pv("!document.getElementById('cityChoices').hidden"));
  await click('btnCitySave');
  await until(() => pv("!document.getElementById('btnSetupNext').disabled"));
  await click('weatherEnabled');
  await until(() => pv("!document.getElementById('weatherEnabled').disabled"));
  check('天气离线也能保存城市并继续引导', queries === 1 && (await pv('window.weatherAPI.state()')).city.name === '太原');
  fs.mkdirSync(setupFile + '.tmp');
  await click('btnSetupNext');
  await until(() => pv("document.getElementById('setupStatus').textContent.includes('没有保存')"));
  check('进度保存失败时停留原步骤并提示', readState().step === 0 && await pv("!document.getElementById('weatherCard').hidden"));
  fs.rmdirSync(setupFile + '.tmp');
  await click('btnSetupNext');
  await until(() => pv("!document.getElementById('setupMeet').hidden"));
  if (!headless) {
    await ev('window.__clawd.stopWalking()'); await wait(2300);
    await click('btnSetupBelly');
    await until(() => pv("document.getElementById('setupPreviewStatus').textContent.includes('回应你')"));
    check('引导按钮确实使另一个窗口里的小猪做出表情', (await ev('window.__clawd.getState()')).spriteView.startsWith('expr:'));
  }
  fs.writeFileSync('test-results/setup-meet.png', (await panel.webContents.capturePage()).toPNG());
  await click('btnSetupNext');
  await until(() => pv("!document.getElementById('setupDone').hidden"));
  check('完成页准确说明离线和默认预览模式', await pv("document.getElementById('setupSummary').textContent.includes('联网') && document.getElementById('setupFileMode').textContent.includes('只做预览')"));
  fs.mkdirSync(setupFile + '.tmp');
  await click('btnSetupNext');
  await until(() => pv("document.getElementById('setupStatus').textContent.includes('没有保存')"));
  check('完成保存失败不会关闭面板或假报完成', readState().status !== 'done' && !panel.isDestroyed());
  fs.rmdirSync(setupFile + '.tmp');
  fs.writeFileSync('test-results/setup-ready.png', (await panel.webContents.capturePage()).toPNG());
  await click('btnSetupNext'); await leave();
  check('完成状态真正写入，重新读取不再自动弹出', readState().status === 'done' && !new Onboarding({ initial: readState(), save() {} }).shouldOpen());
  if (!headless) check('完成引导只关闭设置窗口，桌宠保留', !pet.isDestroyed() && BrowserWindow.getAllWindows().length === 1);
  await reopen();
  check('完成后仍能手动重开引导', await pv("document.body.classList.contains('in-setup')"));
  fs.mkdirSync(setupFile + '.tmp');
  await click('btnSetupLater');
  await until(() => pv("document.getElementById('setupStatus').textContent.includes('没有保存')"));
  check('稍后设置的保存失败也保留面板', readState().status === 'done' && !panel.isDestroyed());
  fs.rmdirSync(setupFile + '.tmp');
  await click('btnSetupLater'); await leave();
  check('稍后设置持久化，下次不打扰', readState().status === 'later' && !new Onboarding({ initial: readState(), save() {} }).shouldOpen());
  check('引导页面无加载和运行错误', errors.length === 0);
  fs.writeFileSync('test-results/onboarding-smoke.json', JSON.stringify({ passed: tests.length, tests, platform: process.platform, nativeWindowLifecycle: !headless }, null, 2));
  console.log(`SUMMARY ${tests.length}/${tests.length} passed`); app.exit(0);
}
run().catch(error => { console.error(error.stack, errors, temp); app.exit(1); });
setTimeout(() => { console.error('TIMEOUT'); app.exit(2); }, 60000);
