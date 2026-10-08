'use strict';

// Open-Meteo current 是天气模型的当前估计值，不冒充本地传感器实测。
const INTERVAL = 30 * 60 * 1000;
const MAX_CACHE_AGE = 3 * 60 * 60 * 1000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const cleanText = s => typeof s === 'string' ? s.slice(0, 100) : '';
function cleanCity(c) {
  if (!c || !Number.isSafeInteger(c.id) || !cleanText(c.name) || !finite(c.latitude)
    || !finite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) return null;
  return { id: c.id, name: cleanText(c.name), admin1: cleanText(c.admin1), country: cleanText(c.country), latitude: c.latitude, longitude: c.longitude };
}
function dressFor(w) {
  if ([95, 96, 97, 99].includes(w.code)) return { outfit: 'rain', label: '雷雨' };
  if ([71, 73, 75, 77, 85, 86].includes(w.code)) return { outfit: 'snow', label: '降雪' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(w.code)) return { outfit: 'rain', label: '有雨' };
  if (w.feels <= 5) return { outfit: 'cold', label: '寒冷' };
  if (w.wind >= 30) return { outfit: 'wind', label: '风大' };
  if (w.feels >= 28) return { outfit: 'sun', label: '炎热' };
  if (!w.isDay) return { outfit: 'night', label: '夜间' };
  if ([0, 1].includes(w.code)) return { outfit: 'sun', label: '晴朗' };
  if ([45, 48].includes(w.code)) return { outfit: 'cloud', label: '有雾' };
  return { outfit: 'cloud', label: '多云' };
}
function parseCurrent(data) {
  const c = data && data.current;
  if (!c || !finite(c.temperature_2m) || !finite(c.apparent_temperature) || !finite(c.wind_speed_10m)
    || ![0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99].includes(c.weather_code)
    || c.wind_speed_10m < 0 || ![0, 1].includes(c.is_day)) throw new Error('invalid-weather');
  const w = { temperature: c.temperature_2m, feels: c.apparent_temperature, wind: c.wind_speed_10m, code: c.weather_code, isDay: c.is_day };
  return { ...w, ...dressFor(w) };
}

class WeatherService {
  constructor({ fetchJson, initial = {}, save = () => {}, changed = () => {}, now = Date.now }) {
    this.fetchJson = fetchJson; this.save = save; this.changed = changed; this.now = now;
    this.city = cleanCity(initial.city); this.enabled = initial.enabled !== false;
    this.cache = null; this.error = null; this.pending = null; this.revision = 0; this.nextRequestAt = 0;
    this.choices = new Map(); this.searchRevision = 0;
    const cached = initial.cache;
    if (this.city && cached && cached.cityId === this.city.id && finite(cached.at) && cached.at <= now()) {
      try { this.cache = { cityId: cached.cityId, at: cached.at, weather: parseCurrent({ current: cached.current }) }; } catch { /* 忽略损坏缓存 */ }
    }
  }
  state() {
    const age = this.cache ? this.now() - this.cache.at : Infinity;
    const weather = this.enabled && this.city && age <= MAX_CACHE_AGE ? this.cache.weather : null;
    return { city: this.city, enabled: this.enabled, weather, updatedAt: this.cache ? this.cache.at : null,
      stale: !!weather && (age > INTERVAL || this.error === 'offline'), refreshing: !!this.pending, error: this.error };
  }
  emit() { this.changed(this.state()); }
  persist() {
    const w = this.cache && this.cache.weather;
    this.save({ city: this.city, enabled: this.enabled, cache: w ? {
      cityId: this.city.id, at: this.cache.at, current: { temperature_2m: w.temperature, apparent_temperature: w.feels,
        wind_speed_10m: w.wind, weather_code: w.code, is_day: w.isDay }
    } : null });
  }
  async search(name) {
    const query = cleanText(name).trim();
    if (query.length < 2) return { ok: false, reason: 'short-query', cities: [] };
    const sequence = ++this.searchRevision;
    this.choices.clear();
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: query, count: '8', language: 'zh', format: 'json' });
      const data = await this.fetchJson(url.toString());
      if (sequence !== this.searchRevision) return { ok: false, reason: 'cancelled', cities: [] };
      const cities = (Array.isArray(data.results) ? data.results : []).map(cleanCity).filter(Boolean).slice(0, 8);
      this.choices = new Map(cities.map(c => [c.id, c]));
      return { ok: true, cities };
    } catch { return { ok: false, reason: 'offline', cities: [] }; }
  }
  async select(id) {
    const city = this.choices.get(Number(id));
    if (!city) return { ok: false, reason: 'unknown-city' };
    const before = { city: this.city, cache: this.cache };
    this.city = city; this.cache = null;
    try { this.persist(); } catch { Object.assign(this, before); return { ok: false, reason: 'save-failed' }; }
    this.revision++; this.pending = null; this.nextRequestAt = 0; this.error = null; this.emit();
    await this.refresh();
    return { ok: true, state: this.state() };
  }
  async setEnabled(enabled) {
    const previous = this.enabled;
    this.enabled = !!enabled;
    try { this.persist(); } catch { this.enabled = previous; return { ok: false, reason: 'save-failed' }; }
    this.revision++; this.pending = null; this.nextRequestAt = 0; this.error = null; this.emit();
    if (this.enabled) await this.refresh();
    return { ok: true, state: this.state() };
  }
  async refresh() {
    if (!this.enabled || !this.city) return this.state();
    if (this.pending) return this.pending;
    if (this.now() < this.nextRequestAt) return this.state();
    const revision = this.revision, city = this.city;
    this.nextRequestAt = this.now() + 60000;
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude),
      current: 'temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m', timezone: 'auto',
      temperature_unit: 'celsius', wind_speed_unit: 'kmh' });
    // 微任务边界使同步失败也能在 finally 中释放 pending。
    const task = Promise.resolve().then(() => this.fetchJson(url.toString())).then(data => {
      if (this.revision !== revision || !this.enabled) return;
      const weather = parseCurrent(data);
      this.cache = { cityId: city.id, at: this.now(), weather }; this.error = null;
      try { this.persist(); } catch { this.error = 'save-failed'; }
    }).catch(() => { if (this.revision === revision) this.error = 'offline'; }).finally(() => {
      if (this.revision === revision) { this.pending = null; this.emit(); }
    }).then(() => this.state());
    this.pending = task; this.emit();
    return task;
  }
}
module.exports = { WeatherService, dressFor, parseCurrent, INTERVAL };
