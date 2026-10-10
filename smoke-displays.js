'use strict';
// 屏幕拓扑由夹具替换，窗口、动画、IPC 和文件事务使用真实 Electron。
// 不能替代真实显示器拔插/Explorer/OneDrive 验收；不访问用户桌面。
const { app, BrowserWindow, screen, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-displays-'));
const desk = path.join(temp, 'desktop'), user = path.join(temp, 'profile');
fs.mkdirSync(desk); fs.mkdirSync(user);
fs.writeFileSync(path.join(user, 'onboarding.json'), JSON.stringify({ status: 'done', version: 1, step: 2 }));
process.env.CLAWD_TEST_DESKTOP = desk; process.env.CLAWD_TEST_USERDATA = user;
const shortcut = path.join(desk, '学习软件.lnk');
fs.writeFileSync(shortcut, 'display recovery fixture');
dialog.showMessageBox = async () => ({ response: 1 });
const headless = app.commandLine.getSwitchValue('ozone-platform') === 'headless';
let base, display;
app.whenReady().then(() => {
  base = headless ? { x: 0, y: 0, width: 1280, height: 800 } : screen.getPrimaryDisplay().workArea;
  display = { id: 1, scaleFactor: 1, bounds: { ...base }, workArea: { ...base } };
  screen.getPrimaryDisplay = () => display;
  screen.getDisplayMatching = () => display;
  screen.getDisplayNearestPoint = () => display;
});
const errors = [], tests = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('did-fail-load', (_ev, code, desc) => errors.push(`${code} ${desc}`));
  contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
});
require('./main');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let pet;
const ev = script => pet.webContents.executeJavaScript(script);
const state = () => ev('window.__clawd.getState()');
const q = JSON.stringify;
async function until(fn, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await wait(50); }
  throw Error('Timed out waiting for display recovery');
}
function check(name, condition) { assert.ok(condition, name); tests.push(name); console.log(`PASS ${tests.length}: ${name}`); }
function contained(b, area) {
  return b.x >= area.x - 2 && b.y >= area.y - 2 && b.x + b.width <= area.x + area.width + 2 && b.y + b.height <= area.y + area.height + 2;
}
async function changed(event = 'display-metrics-changed', metrics = ['workArea']) {
  const before = (await state()).displayRevision;
  screen.emit(event, {}, display, metrics);
  await until(async () => (await state()).displayRevision > before);
  await wait(200); // 等待收起气泡、取消动作后的锚点同步
}
async function startMeal() {
  await ev(`window.__displayMeal = null; window.iconAPI.requestEat(${q(shortcut)}, true).then(r=>{window.__displayMeal=r}); undefined`);
}
async function mealResult() {
  await until(() => ev('Boolean(window.__displayMeal)'));
  return ev('window.__displayMeal');
}
async function run() {
  await app.whenReady();
  await until(async () => {
    pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    return pet && await ev('Boolean(window.__clawd?.getState().sprites)');
  });
  await wait(3000);
  await ev('window.__clawd.stopWalking()');
  const original = pet.getBounds();
  const inset = { x: base.x + 40, y: base.y + 40, width: Math.min(700, base.width - 80), height: Math.min(480, base.height - 80) };
  display.workArea = inset;
  await changed('display-removed');
  check('移除屏幕后把小猪放回剩余工作区', contained(pet.getBounds(), inset));
  check('恢复后主进程与渲染进程使用同一脚底锚点', await ev('(async()=>{const p=await petAPI.getPosition(),a=__clawd.getState().anchor; return Math.abs(p.anchorX-a.cx)<=1&&Math.abs(p.anchorY-a.feet)<=1})()'));
  const saved = await ev("JSON.parse(localStorage.getItem('clawdPetStateV1')).anchor");
  check('恢复位置持久化，不继续记住断开的屏幕', Math.abs(saved.cx-(await state()).anchor.cx)<=1 && Math.abs(saved.feet-(await state()).anchor.feet)<=1);
  const parked = pet.getBounds();
  await changed('display-added');
  check('接入显示器时不移动已经可见的小猪', pet.getBounds().x === parked.x && pet.getBounds().y === parked.y);
  const revision = (await state()).displayRevision;
  screen.emit('display-metrics-changed', {}, display, ['colorDepth']);
  await wait(80);
  check('无关的色深变化不会打断动作', (await state()).displayRevision === revision);
  check('屏幕变更前发出的旧移动请求被拒绝', !(await ev(`petAPI.startMove(${original.x},${original.y},1500,undefined,0)`)));

  await ev(`petAPI.setBounds({x:${original.x},y:${original.y},width:${parked.width},height:${parked.height},anchorX:${(await state()).anchor.cx-parked.x},anchorY:${(await state()).anchor.feet-parked.y},preserveAnchor:false,revision:0})`);
  check('迟到的拖动布局不会把小猪搬回旧屏幕', contained(pet.getBounds(), inset));
  await ev("__clawd.runReaction('nose')");
  display.scaleFactor = 1.5;
  await changed('display-metrics-changed', ['scaleFactor', 'bounds']);
  const anchor = (await state()).anchor;
  await wait(2100);
  check('缩放变化后气泡收起也不会跳回旧位置', Math.abs((await state()).anchor.cx-anchor.cx)<=1 && Math.abs((await state()).anchor.feet-anchor.feet)<=1 && contained(pet.getBounds(), inset));

  await ev("const c=document.getElementById('stage'); c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,pointerType:'mouse',button:0,screenX:200,screenY:200})); c.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',screenX:240,screenY:240})); undefined");
  check('拖动夹具已进入真实拖动状态', (await state()).dragging);
  await changed();
  const afterDrag = (await state()).anchor;
  await ev("document.getElementById('stage').dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',screenX:900,screenY:900})); undefined");
  await wait(150);
  const afterPointer = await state();
  check('屏幕变更释放拖动，后续旧指针事件不再移动小猪', !afterPointer.dragging && Math.abs(afterPointer.anchor.cx-afterDrag.cx)<=1 && Math.abs(afterPointer.anchor.feet-afterDrag.feet)<=1);

  display.workArea = { ...base };
  await changed();
  await ev("iconAPI.setSettings({preferences:{'.lnk':'like'},cooldownMs:0,dailyLimit:10})");
  await ev('iconAPI.setRealMode(true)');
  pet.setPosition(base.x + 600, base.y + 400);
  await startMeal();
  await until(async () => (await state()).mvState === 'icon-moving');
  await changed('display-removed');
  check('追逐中变更屏幕会取消进食并保留原快捷方式', (await mealResult()).reason === 'display-changed' && fs.existsSync(shortcut));
  await until(async () => !(await state()).mealBusy);
  check('取消后脚步与窗口均停止', (await state()).mvState === 'idle' && (await state()).frameCol === 0);
  await startMeal();
  await until(async () => /^icon:row0:/.test((await state()).spriteView));
  await changed('display-metrics-changed', ['scaleFactor']);
  check('吞吃途中缩放也会撤销事务，不晚到移动文件', (await mealResult()).reason === 'display-changed' && fs.existsSync(shortcut));
  await until(async () => !(await state()).mealBusy);
  const pending = await ev(`iconAPI.prepare({path:${q(shortcut)},real:true,hunger:100})`);
  check('取消后可以重新申请合法进食事务', pending.ok);
  await changed();
  check('屏幕变更废除已发出的进食凭据', (await ev(`iconAPI.eat(${q(pending.token)})`)).reason === 'invalid-meal' && fs.existsSync(shortcut));

  const seedMeal = await ev(`iconAPI.prepare({path:${q(shortcut)},real:true,hunger:100})`);
  const eaten = await ev(`iconAPI.eat(${q(seedMeal.token)})`);
  check('种植夹具只在一次性桌面创建可恢复的种子', eaten.ok);
  await ev(`window.__displayMeal=null;iconAPI.plantAnimate(${q(eaten.record.id)}).then(r=>{window.__displayMeal=r}); undefined`);
  await until(async () => /^icon:row2:/.test((await state()).spriteView));
  await changed();
  const record = (await ev('iconAPI.state()')).stored.find(item=>item.id===eaten.record.id);
  check('播种时屏幕改变保留未种植状态和仓库文件', (await mealResult()).reason === 'display-changed' && record.status === 'stored' && record.existsInBelly);
  await until(async () => !(await state()).mealBusy);
  await ev('iconAPI.restoreAll()');
  check('取消后的种子仍能完整还原', fs.readFileSync(shortcut,'utf8') === 'display recovery fixture');
  const batch = await ev('iconAPI.beginRage()');
  check('怒气批次夹具可启动', batch.ok);
  await changed();
  check('屏幕变更后旧怒气批次不能继续吃下一个', (await ev(`iconAPI.prepare({rageToken:${q(batch.token)},real:true,hunger:100})`)).reason === 'cancelled');

  await ev('window.__clawd.startWalking()');
  await until(async () => (await state()).mvState === 'moving', 14000);
  display.workArea = inset;
  await changed();
  check('自主走动中重新定位会先停驻，并保留走动开关', (await state()).walking && (await state()).mvState === 'idle' && contained(pet.getBounds(),inset));
  await ev('window.__clawd.stopWalking()');

  display.workArea = { ...base };
  screen.emit('display-added', {}, display);
  display.workArea = { ...inset, x: inset.x + 20, width: inset.width - 20 };
  screen.emit('display-metrics-changed', {}, display, ['workArea', 'scaleFactor']);
  display.workArea = inset;
  await changed('display-removed');
  check('连续屏幕事件最终以最新工作区为准', contained(pet.getBounds(),inset));

  await ev(`{const saved=JSON.parse(localStorage.getItem('clawdPetStateV1'));saved.anchor={cx:${base.x+base.width+1000},feet:${base.y+base.height+1000}};localStorage.setItem('clawdPetStateV1',JSON.stringify(saved));} undefined`);
  await new Promise(resolve=>{pet.webContents.once('did-finish-load',resolve);pet.reload();});
  await until(()=>ev('Boolean(window.__clawd?.getState().sprites)'));
  await wait(3000);
  check('重载时旧副屏存档也能恢复到当前屏幕', contained(pet.getBounds(),inset));
  check('重载后显示版本同步，正常移动 API 仍可使用', await ev(`petAPI.startMove(${pet.getBounds().x},${pet.getBounds().y},1500)`));
  await ev('petAPI.cancelMove()');

  if (!headless) {
    display.workArea = { ...base };
    await ev('iconAPI.openPanel()');
    let panel;
    await until(() => (panel=BrowserWindow.getAllWindows().find(w=>w!==pet)) && !panel.webContents.isLoading());
    panel.setPosition(base.x + base.width - 460, base.y + base.height - 620);
    display.workArea = inset;
    await changed('display-removed');
    const b = panel.getBounds();
    check('仓库面板也回到剩余屏幕，小工作区仍能抓住标题栏', b.x>=inset.x-2 && b.x+Math.min(b.width,inset.width)<=inset.x+inset.width+2 && b.y>=inset.y-2 && b.y<inset.y+inset.height);
    panel.close();
  }
  check('页面与 IPC 无运行错误', errors.length === 0);
  fs.mkdirSync('test-results',{recursive:true});
  fs.writeFileSync('test-results/display-recovery.png',(await pet.webContents.capturePage()).toPNG());
  fs.writeFileSync('test-results/display-recovery.json',JSON.stringify({passed:tests.length,tests,platform:process.platform,syntheticDisplays:true,headless,electron:process.versions.electron},null,2));
  console.log(`SUMMARY ${tests.length}/${tests.length} passed (synthetic displays)`);
  app.exit(0);
}
run().catch(async error=>{console.error(error.stack);try{console.error('STATE',await state());console.error('BOUNDS',pet.getBounds());}catch{}console.error('Renderer errors:',errors);app.exit(1);});
setTimeout(()=>{console.error('TIMEOUT');app.exit(2);},120000);
