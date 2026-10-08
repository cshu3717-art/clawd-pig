'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WeatherService, dressFor } = require('../lib/weather');
const cities = [{ id: 1, name: '太原', admin1: '山西', country: '中国', latitude: 37.87, longitude: 112.55 }, { id: 2, name: '北京', latitude: 39.9, longitude: 116.4 }];
const response = (code = 61) => ({ current: { temperature_2m: 18, apparent_temperature: 17, wind_speed_10m: 8, weather_code: code, is_day: 1 } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
test('天气码优先于温度；雨雪、风、夜晚使用对应装扮', () => {
  const w = { code: 0, feels: 20, wind: 5, isDay: 1 };
  for (const code of [51, 56, 63, 82, 95, 97, 99]) assert.equal(dressFor({ ...w, code }).outfit, 'rain');
  for (const code of [71, 77, 85, 86]) assert.equal(dressFor({ ...w, code }).outfit, 'snow');
  assert.equal(dressFor({ ...w, feels: -2 }).outfit, 'cold');
  assert.equal(dressFor({ ...w, wind: 40 }).outfit, 'wind');
  assert.equal(dressFor({ ...w, isDay: 0 }).outfit, 'night');
});
test('首次不请求定位；搜索只接受合法地点并保存所选城市', async () => {
  const urls = []; let saved;
  const service = new WeatherService({ fetchJson: async url => { urls.push(new URL(url)); return url.includes('/search') ? { results: [...cities, { id: 3, name: 'bad', latitude: 999, longitude: 0 }] } : response(); }, save: data => { saved = data; } });
  await service.refresh(); assert.equal(urls.length, 0);
  assert.equal((await service.select(1)).ok, false);
  assert.equal((await service.search('太原')).cities.length, 2);
  assert.equal((await service.select(1)).ok, true);
  assert.equal(saved.city.name, '太原'); assert.equal(service.state().weather.outfit, 'rain');
  assert.equal(urls[0].hostname, 'geocoding-api.open-meteo.com');
  assert.equal(urls[1].searchParams.get('latitude'), '37.87');
});
test('并发刷新共用请求，手动刷新至少间隔一分钟', async () => {
  let requests = 0; const pending = deferred();
  const service = new WeatherService({ initial: { city: cities[0] }, fetchJson: () => { requests++; return pending.promise; } });
  const first = service.refresh(), second = service.refresh();
  await new Promise(r => setImmediate(r)); assert.equal(requests, 1);
  pending.resolve(response()); await Promise.all([first, second]); await service.refresh();
  assert.equal(requests, 1); assert.equal(service.state().refreshing, false);
});
test('换城市后，旧城市的迟到结果不能覆盖新天气', async () => {
  const old = deferred(); let requests = 0;
  const service = new WeatherService({ fetchJson: url => url.includes('/search') ? Promise.resolve({ results: cities }) : ++requests === 1 ? old.promise : Promise.resolve(response(75)) });
  await service.search('城市'); const first = service.select(1);
  await new Promise(r => setImmediate(r)); await service.select(2); old.resolve(response(0)); await first;
  assert.equal(service.state().city.id, 2); assert.equal(service.state().weather.outfit, 'snow');
});
test('关闭天气时忽略在途结果，继续保持原装', async () => {
  const pending = deferred();
  const service = new WeatherService({ initial: { city: cities[0] }, fetchJson: () => pending.promise });
  const loading = service.refresh(); await service.setEnabled(false); pending.resolve(response()); await loading;
  assert.equal(service.state().weather, null); assert.equal(service.state().refreshing, false);
});
test('断网显示旧数据，超过三小时停止使用；重启仍可读缓存', async () => {
  let time = 1000000, fail = false, saved;
  const service = new WeatherService({ now: () => time, initial: { city: cities[0] }, save: data => { saved = data; }, fetchJson: async () => { if (fail) throw Error('offline'); return response(); } });
  await service.refresh(); const restored = new WeatherService({ initial: saved, now: () => time, fetchJson: async () => response() });
  assert.equal(restored.state().weather.outfit, 'rain');
  fail = true; time += 31 * 60000; await service.refresh();
  assert.equal(service.state().stale, true); assert.equal(service.state().error, 'offline');
  time += 3 * 3600000; assert.equal(service.state().weather, null);
});
test('无效天气不伪造温度；城市写入失败回滚选择', async () => {
  const service = new WeatherService({ fetchJson: async url => url.includes('/search') ? { results: cities } : { current: { temperature_2m: null } }, initial: { city: cities[0] }, save: () => { throw Error('disk'); } });
  await service.refresh(); assert.equal(service.state().weather, null);
  await service.search('北京'); assert.equal((await service.select(2)).reason, 'save-failed');
  assert.equal(service.state().city.id, 1);
});
