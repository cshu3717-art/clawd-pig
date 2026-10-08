'use strict';
// 所有读写只落在一次性测试桌面。禁止依赖开发者真实桌面或已有设置。
const { app, BrowserWindow, dialog, screen, net } = require('electron');
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
let weatherRequests = 0, weatherCode = 61;
// 天气接口固定夹具；集成测试不依赖网络，不发送用户位置。
const originalFetch = net.fetch.bind(net);
net.fetch = async (url, options) => {
  const host = new URL(url).hostname;
  if (host === 'geocoding-api.open-meteo.com') return new Response(JSON.stringify({ results: [
    { id: 1792947, name: '太原', admin1: '山西', country: '中国', latitude: 37.87, longitude: 112.55 },
    { id: 1816670, name: '北京', admin1: '北京', country: '中国', latitude: 39.9, longitude: 116.4 },
  ] }));
  if (host === 'api.open-meteo.com') {
    weatherRequests++;
    return new Response(JSON.stringify({ current: { temperature_2m: 18, apparent_temperature: 17, weather_code: weatherCode, wind_speed_10m: 8, is_day: 1 } }));
  }
  return originalFetch(url, options);
};
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

  const seedId = eaten.record.id;
  const beginPlant = async () => ev(`window.__smokeResult = null; window.iconAPI.plantAnimate(${q(seedId)}).then(r=>{window.__smokeResult=r}); undefined`);
  const seedStatus = async () => (await ev('window.iconAPI.state()')).stored.find(e => e.id === seedId)?.status;
  check('种植状态不能绕过动画凭据直接修改', (await ev(`window.iconAPI.plant(${q(seedId)})`)).reason === 'invalid-plant');
  await ev("window.__clawd.runReaction('nose')");
  check('小猪忙碌时种植请求返回失败并保留种子', (await ev(`window.iconAPI.plantAnimate(${q(seedId)})`)).reason === 'busy' && await seedStatus() === 'stored');
  await wait(1900);
  await beginPlant();
  await until(async () => /^icon:row2:/.test((await state()).spriteView));
  check('播种动画过程中仍是未种植的种子', await seedStatus() === 'stored');
  check('播种过程中重复点击被拒绝', (await ev(`window.iconAPI.plantAnimate(${q(seedId)})`)).reason === 'busy');
  await ev('window.iconAPI.cancel()');
  await endMeal();
  await until(async () => !(await state()).mealBusy);
  check('取消播种后保留种子并释放动作占用', await seedStatus() === 'stored');
  fs.mkdirSync(path.join(belly, 'manifest.json.tmp'));
  await beginPlant();
  check('种植保存失败不会假报成功', (await endMeal()).reason === 'storage-write-failed');
  fs.rmdirSync(path.join(belly, 'manifest.json.tmp'));
  check('保存失败回滚后种子仍可重试', await seedStatus() === 'stored');
  await beginPlant();
  check('完整播种完成后才进入可收获状态', (await endMeal()).ok && await seedStatus() === 'planting');

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

  for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(desk, `怒气测试${i}.lnk`), `rage fixture ${i}`);
  const batch = await ev('window.iconAPI.beginRage()');
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const prepared = await ev(`window.iconAPI.prepare({rageToken:${q(batch.token)}})`);
    seen.push(prepared.entry.path);
    await ev(`window.iconAPI.release(${q(prepared.token)})`);
  }
  check('怒气预览选择五个不同图标，主进程拒绝第六个', new Set(seen).size === 5 && seen.every(file => fs.existsSync(file)) && (await ev(`window.iconAPI.prepare({rageToken:${q(batch.token)}})`)).reason === 'batch-complete');
  await ev(`window.iconAPI.endRage(${q(batch.token)})`);
  await ev("window.__clawd.runReaction('ear')");
  check('揪耳朵增加怒气', (await state()).anger === 25);
  await ev("window.__clawd.runReaction('belly')");
  check('摸肚子可以消气', (await state()).anger === 10);
  await ev("window.__clawd.runReaction('nose'); window.__clawd.runReaction('nose')");
  await wait(1900);
  const enrage = async () => ev("for(let i=0;i<4;i++)window.__clawd.runReaction('ear'); undefined");
  await ev('window.iconAPI.setSettings({scanOnly:false,dailyLimit:3})');
  pet.setPosition(650, 400);
  await enrage();
  await until(async () => (await state()).rageBusy && (await state()).mvState === 'icon-moving');
  await ev('window.iconAPI.cancel()');
  await until(async () => !(await state()).rageBusy);
  check('怒气追逐中停止，后续图标也不再移动', (await state()).lastRageResult.reason === 'cancelled' && (await ev('window.iconAPI.stored()')).length === 0);
  await enrage();
  await until(async () => (await state()).rageBusy);
  await until(async () => /^icon:row0:/.test((await state()).spriteView));
  check('怒气第一口也要等完整动画才存储', (await ev('window.iconAPI.stored()')).length === 0);
  await until(async () => !(await state()).rageBusy, 65000);
  const rageResult = (await state()).lastRageResult;
  check('怒气依次吃完五个并保存五份可恢复记录', rageResult.ok && rageResult.count === 5 && !rageResult.preview && (await ev('window.iconAPI.stored()')).length === 5);
  check('怒气真实移动遵守独立冷却', (await ev('window.iconAPI.beginRage()')).reason === 'cooldown');
  check('五个快捷方式都能一键恢复', (await ev('window.iconAPI.restoreAll()')).restored === 5);
  await ev('window.iconAPI.setSettings({scanOnly:true,rageEnabled:false})');
  check('怒气开关关闭后不能启动追吃', (await ev('window.iconAPI.beginRage()')).reason === 'rage-disabled');
  check('未选城市时不查询天气', weatherRequests === 0 && (await ev('window.weatherAPI.state()')).city === null);
  await ev("window.weatherAPI.search('太原')");
  await ev('window.weatherAPI.select(1792947)');
  await until(async () => (await state()).weather?.weather?.outfit === 'rain');
  check('选城市后天气通过 IPC 更新到小猪雨天配饰', weatherRequests === 1 && (await state()).weather.city.name === '太原');
  fs.mkdirSync('test-results', { recursive: true });
  await wait(2500);
  fs.writeFileSync('test-results/pig-rain.png', (await pet.webContents.capturePage()).toPNG());
  await ev('window.weatherAPI.setEnabled(false)');
  await until(async () => (await state()).weather.weather === null);
  check('关闭天气立即卸下配饰', !(await state()).weather.enabled);
  weatherCode = 75;
  await ev('window.weatherAPI.setEnabled(true)');
  await until(async () => (await state()).weather?.weather?.outfit === 'snow');
  check('重新开启后按雪天换装并保存城市', JSON.parse(fs.readFileSync(path.join(user, 'weather.json'), 'utf8')).city.name === '太原');
  await wait(100);
  fs.writeFileSync('test-results/pig-snow.png', (await pet.webContents.capturePage()).toPNG());
  if (headless) { pet.setSize(460, 620); await pet.loadURL('app://pet/panel.html'); }
  else await ev('window.iconAPI.openPanel()');
  let panel;
  await until(async () => {
    panel = headless ? pet : BrowserWindow.getAllWindows().find(w => w !== pet);
    return panel && await panel.webContents.executeJavaScript("document.getElementById('mode') && document.getElementById('mode').textContent === '只预览'");
  });
  const pv = script => panel.webContents.executeJavaScript(script);
  await until(() => pv("document.getElementById('weatherStatus').textContent.includes('太原')"));
  check('面板显示选定城市与天气', await pv("document.getElementById('weatherStatus').textContent.includes('降雪')"));
  await pv("document.getElementById('cityQuery').value='北京'; document.getElementById('btnCitySearch').click()");
  await until(() => pv("!document.getElementById('cityChoices').hidden"));
  await pv("document.getElementById('citySelect').value='1816670'; document.getElementById('btnCitySave').click()");
  await until(() => pv("document.getElementById('weatherStatus').textContent.startsWith('北京') && !document.getElementById('btnCitySave').disabled"));
  check('面板搜索和更换城市可用', JSON.parse(fs.readFileSync(path.join(user, 'weather.json'), 'utf8')).city.name === '北京');
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
run().catch(async error => { console.error(error.stack); try { console.error('STATE', JSON.stringify(await state())); console.error('RESULT', JSON.stringify(await ev('window.__smokeResult'))); } catch {} console.error('Renderer errors:', errors); console.error('Temporary fixture:',temp); app.exit(1); });
setTimeout(() => { console.error('TIMEOUT'); app.exit(2); }, 180000);
