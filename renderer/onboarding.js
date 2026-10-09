(function () {
  'use strict';
  const api = window.setupAPI;
  const $ = id => document.getElementById(id);
  const titles = ['陪你在哪座城市？', '认识一下这只小猪', '从今天起，一起待着'];
  const descriptions = ['晴天戴帽子，下雨换雨装。选一座城市就好。', '不用记快捷键，摸摸它、右键点它就可以。', '设置已经记住，以后打开会直接来到桌面。'];
  let active = false, step = 0, busy = false, weather = null, iconState = null;
  const say = message => { $('setupStatus').textContent = message; };
  function render() {
    document.body.classList.toggle('in-setup', active);
    $('setupIntro').hidden = $('setupFooter').hidden = !active;
    $('weatherCard').hidden = active && step !== 0;
    $('setupMeet').hidden = !active || step !== 1;
    $('setupDone').hidden = !active || step !== 2;
    if (!active) return;
    $('setupTitle').textContent = titles[step];
    $('setupDescription').textContent = descriptions[step];
    $('setupProgress').textContent = `${step + 1} / 3 · ${['选城市', '认识小猪', '开始陪伴'][step]}`;
    document.querySelectorAll('.setup-steps li').forEach((el, index) => {
      if (index === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    $('btnSetupBack').hidden = step === 0;
    $('btnSetupSkip').hidden = step !== 0;
    $('btnSetupNext').textContent = step === 2 ? '开始陪伴' : '下一步';
    $('btnSetupNext').disabled = busy || (step === 0 && !weather?.city);
    for (const id of ['btnSetupBack', 'btnSetupSkip', 'btnSetupLater']) $(id).disabled = busy;
    const city = weather?.city;
    $('setupSummary').textContent = city && weather.enabled
      ? `天气城市：${[city.name, city.admin1, city.country].filter(Boolean).join(' · ')}。小猪会跟着天气换配饰${weather.weather ? '。' : '，联网获取天气后就能看到。'}`
      : '天气换装先休息，随时可以在设置里开启。';
    $('setupFileMode').textContent = iconState
      ? (iconState.settings.scanOnly ? '图标互动目前只做预览。以后想让它吃快捷方式，可到图标仓库单独开启。' : '你之前已开启真实移动快捷方式；可以在图标仓库关闭，并随时恢复。')
      : '图标设置暂时读不到，请从图标仓库确认当前模式。';
  }
  async function open() {
    try {
      const state = await api.state();
      [weather, iconState] = await Promise.all([window.weatherAPI.state(), window.iconAPI.state()]);
      step = state.status === 'pending' ? state.step : 0;
      active = true; say(''); render();
      $('setupTitle').focus();
    } catch { active = true; render(); say('设置暂时读不到，请关掉面板后重新打开。'); }
  }
  async function moveTo(next) {
    const result = await api.progress(next);
    if (!result.ok) { say('进度没有保存，请再试一次。'); return; }
    step = result.state.step; say(''); render(); $('setupTitle').focus();
  }
  async function perform(action) {
    if (busy) return;
    busy = true; render();
    try { await action(); } catch { say('设置没有保存，请再试一次。'); }
    finally { busy = false; render(); }
  }
  async function leave(result) {
    if (!result.ok) { say('设置没有保存，请再试一次。'); return; }
    active = false; render();
    await api.close();
    $('btnSetupOpen').focus();
  }
  $('btnSetupOpen').onclick = open;
  $('btnSetupLater').onclick = () => perform(async () => leave(await api.later()));
  $('btnSetupBack').onclick = () => perform(() => moveTo(Math.max(0, step - 1)));
  $('btnSetupNext').onclick = () => perform(async () => {
    if (step === 2) await leave(await api.finish());
    else if (step !== 0 || weather?.city) await moveTo(step + 1);
  });
  $('btnSetupSkip').onclick = () => perform(async () => {
    const result = await window.weatherAPI.setEnabled(false);
    if (!result.ok) { say('天气设置没有保存，请重试。'); return; }
    weather = result.state; await moveTo(1);
  });
  async function preview(action) {
    $('btnSetupBelly').disabled = $('btnSetupWave').disabled = true;
    try {
      const result = await api.preview(action);
      $('setupPreviewStatus').textContent = result.ok
        ? (action === 'belly' ? '它在桌面上回应你啦，摸肚子也能帮它消气。' : '它朝你挥手啦。')
        : result.reason === 'busy' ? '小猪正在做别的动作，等它停下再摸摸。' : '小猪还没回应，稍后再试一下。';
    } catch { $('setupPreviewStatus').textContent = '互动暂时没接上，稍后可以直接摸小猪。'; }
    finally { $('btnSetupBelly').disabled = $('btnSetupWave').disabled = false; }
  }
  $('btnSetupBelly').onclick = () => preview('belly');
  $('btnSetupWave').onclick = () => preview('wave');
  window.weatherAPI.onChange(state => { weather = state; render(); });
  window.iconAPI.onChanged(() => window.iconAPI.state().then(state => { iconState = state; render(); }).catch(() => {}));
  api.onOpen(open);
  api.portrait().then(url => {
    if (!url) return;
    const image = new Image();
    image.onload = () => {
      const ctx = $('setupPortrait').getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, image.naturalWidth / 4, image.naturalHeight / 4, 0, 0, 96, 96);
    };
    image.src = url;
  }).catch(() => {});
  if (location.hash === '#setup') open();
})();
