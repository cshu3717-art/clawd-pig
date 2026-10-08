(function () {
  'use strict';
  const api = window.weatherAPI;
  const $ = id => document.getElementById(id);
  const place = city => [city.name, city.admin1, city.country].filter(Boolean).join(' · ');
  function show(state) {
    $('weatherEnabled').checked = state.enabled;
    $('btnWeatherRefresh').disabled = !state.enabled || !state.city || state.refreshing;
    if (!state.city) { $('weatherStatus').textContent = '还没选城市，小猪先穿自己的衣服。'; return; }
    if (!state.enabled) { $('weatherStatus').textContent = `${place(state.city)} · 已暂停查询和换装`; return; }
    if (state.refreshing) { $('weatherStatus').textContent = `${place(state.city)} · 正在查询…`; return; }
    if (!state.weather) { $('weatherStatus').textContent = `${place(state.city)} · 暂时取不到天气，请稍后刷新。`; return; }
    const w = state.weather;
    const time = new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('weatherStatus').textContent = `${place(state.city)} · ${w.label} ${Math.round(w.temperature)}°C（体感 ${Math.round(w.feels)}°C）· ${time} 更新${state.stale ? ' · 旧数据，等待联网更新' : ''}${state.error === 'save-failed' ? ' · 本次缓存未保存' : ''}`;
  }
  $('btnCitySearch').onclick = async () => {
    $('btnCitySearch').disabled = true; $('cityChoices').hidden = true;
    $('cityStatus').textContent = '正在寻找城市…';
    try {
      const result = await api.search($('cityQuery').value);
      $('citySelect').replaceChildren();
      if (!result.ok) { $('cityStatus').textContent = result.reason === 'short-query' ? '请至少输入两个字。' : '搜索暂时失败，稍后再试。'; return; }
      for (const city of result.cities) {
        const option = document.createElement('option'); option.value = city.id; option.textContent = place(city);
        $('citySelect').appendChild(option);
      }
      $('cityChoices').hidden = !result.cities.length;
      $('cityStatus').textContent = result.cities.length ? '核对省份和国家，再使用这座城市。' : '没有找到，试试拼音或英文城市名。';
    } catch { $('cityStatus').textContent = '搜索未完成，请重试。'; }
    finally { $('btnCitySearch').disabled = false; }
  };
  $('cityQuery').onkeydown = event => { if (event.key === 'Enter' && !$('btnCitySearch').disabled) $('btnCitySearch').click(); };
  $('btnCitySave').onclick = async () => {
    $('btnCitySave').disabled = true;
    try {
      const result = await api.select(Number($('citySelect').value));
      $('cityStatus').textContent = result.ok ? '城市已保存，下次打开会记住。' : '城市未保存，请重新搜索后再试。';
      if (result.state) show(result.state);
    } catch { $('cityStatus').textContent = '城市未保存，请重试。'; }
    finally { $('btnCitySave').disabled = false; }
  };
  $('weatherEnabled').onchange = async event => {
    event.target.disabled = true;
    try { const result = await api.setEnabled(event.target.checked); if (!result.ok) $('cityStatus').textContent = '设置没有保存，请重试。'; show(await api.state()); }
    catch { $('cityStatus').textContent = '设置未完成，请重试。'; }
    finally { event.target.disabled = false; }
  };
  $('btnWeatherRefresh').onclick = async () => {
    try { show(await api.refresh()); } catch { $('weatherStatus').textContent = '天气查询失败，请稍后重试。'; }
  };
  $('btnWeatherSource').onclick = () => api.source().catch(() => { $('cityStatus').textContent = '天气来源：https://open-meteo.com/'; });
  api.onChange(show);
  api.state().then(show).catch(() => { $('weatherStatus').textContent = '设置读取失败，请重新打开面板。'; });
})();
