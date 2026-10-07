'use strict';
(function () {
  const api = window.iconAPI;
  const $ = id => document.getElementById(id);
  let scanned = false, busy = false, scanSequence = 0;
  const messages = {
    busy: '小猪正在忙，等这一段结束再试。',
    scanOnly: '先勾选“允许真实移动”。',
    'not-hungry': '小猪闻了闻，这次不想吃。',
    'daily-limit': '今天已经吃够了，种回来陪它玩吧。',
    cooldown: '小猪还在消化，稍后再试。',
    'position-unavailable': '没有识别到这个图标的实际位置，可以先预览。',
    'target-unreachable': '这次没有走到目标旁，快捷方式仍在桌面。',
    'target-changed': '快捷方式刚刚变动了，请重新扫描。',
    cancelled: '已取消，尚未吞下的快捷方式仍在桌面。',
    'animation-unavailable': '吃图标素材未就绪，没有移动快捷方式。',
    'storage-write-failed': '仓库记录保存失败，快捷方式仍在桌面。',
    'no-candidates': '这个快捷方式已不在候选列表，请重新扫描。',
    failed: '没有完成操作，请重试。',
  };
  const statusText = { stored: '已吃下，可种植', planting: '种植中，可收获', moving: '处理中' };
  function say(message) { $('status').textContent = message; }
  function resultMessage(result) {
    if (!result || !result.ok) return messages[result && result.reason] || '操作未完成，请刷新后重试。';
    return result.preview ? '预览完成，真实快捷方式没有移动。' : '吃好啦，可以在下面种植或恢复。';
  }
  function button(text, action) {
    const b = document.createElement('button');
    b.className = 'mini'; b.textContent = text;
    b.onclick = async () => {
      if (busy) return;
      busy = true; b.disabled = true;
      try { await action(); }
      catch { say('操作没完成，请刷新后再试。'); }
      finally { busy = false; b.disabled = false; await refresh(); if (scanned) await scan(); }
    };
    return b;
  }
  function row(name, detail) {
    const el = document.createElement('div'); el.className = 'item';
    const img = document.createElement('img'); img.alt = '';
    const label = document.createElement('span'); label.className = 'nm'; label.textContent = name;
    const sub = document.createElement('small'); sub.className = 'st'; sub.textContent = detail;
    label.appendChild(document.createElement('br')); label.appendChild(sub);
    el.append(img, label);
    return { el, img };
  }
  async function refresh() {
    const st = await api.state();
    if (!st) return;
    $('deskPath').textContent = st.desktop || '未找到桌面';
    $('bellyPath').textContent = st.belly || '—';
    const scanOnly = st.settings.scanOnly;
    $('mode').textContent = scanOnly ? '只预览' : '真实移动已开启';
    $('mode').className = 'badge' + (scanOnly ? '' : ' warn');
    $('scanOnly').checked = !scanOnly;
    const box = $('seeds'); box.replaceChildren();
    if (!st.stored.length) { box.textContent = '还没有种子，吃下的快捷方式会保存在这里。'; return; }
    for (const seed of st.stored) {
      const { el } = row(seed.name, statusText[seed.status] || seed.status);
      const plant = button('种植', async () => {
        const result = await api.plantAnimate(seed.id);
        say(result && result.ok ? '种下了，点“收获”就能恢复。' : '没有种下，请刷新仓库。');
      });
      plant.disabled = seed.status !== 'stored';
      const restore = button(seed.status === 'planting' ? '收获' : '恢复', async () => {
        const result = await api.harvest(seed.id);
        say(result && result.ok ? '已放回桌面。同名文件会自动改名保留。' : '恢复未完成，种子仍保存在仓库。');
      });
      el.append(plant, restore); box.appendChild(el);
    }
  }
  async function scan() {
    const sequence = ++scanSequence;
    scanned = true;
    const box = $('candidates'); box.textContent = '正在定位桌面图标…';
    const [result, st] = await Promise.all([api.scan(), api.state()]);
    if (sequence !== scanSequence) return;
    box.replaceChildren();
    if (!result || !result.ok) { box.textContent = '暂时读不到桌面，请稍后重新扫描。'; return; }
    if (!result.entries.length) { box.textContent = '没有可吃的快捷方式，只识别桌面上的 .lnk / .url。'; return; }
    for (const entry of result.entries) {
      const located = entry.target && ['desktop', 'test'].includes(entry.target.source);
      const { el, img } = row(entry.name, located ? '已找到桌面位置' : '未定位，只能预览路线');
      const preview = button('走过去预览', async () => {
        say('小猪出发了，点它或拖动它可以取消。');
        say(resultMessage(await api.requestEat(entry.path, false)));
      });
      const eat = button('走过去吃', async () => {
        say('正在走近、闻一闻、吃下…');
        say(resultMessage(await api.requestEat(entry.path, true)));
      });
      eat.disabled = st.settings.scanOnly || !located;
      el.append(preview, eat); box.appendChild(el);
      api.iconOf(entry.path).then(url => { if (url) img.src = url; }).catch(() => {});
    }
  }
  $('btnScan').onclick = () => scan().catch(() => say('扫描失败，请重试。'));
  $('btnRefresh').onclick = () => refresh().catch(() => say('刷新失败，请重试。'));
  $('btnRestoreAll').onclick = async () => {
    try {
      const result = await api.restoreAll();
      const failed = (result.results || []).filter(r => !r.ok).length;
      say(`已恢复 ${result.restored || 0} 个快捷方式${failed ? `，还有 ${failed} 个需要重试` : '。'}`);
      await refresh(); if (scanned) await scan();
    } catch { say('恢复未完成，请刷新仓库后重试。'); }
  };
  $('scanOnly').addEventListener('change', async event => {
    const enabled = event.target.checked;
    event.target.disabled = true;
    try { await api.setRealMode(enabled); await refresh(); if (scanned) await scan(); }
    catch { say('开关保存失败，请重试。'); await refresh(); }
    finally { event.target.disabled = false; }
  });
  refresh().catch(() => say('仓库读取失败，请重新打开面板。'));
})();
