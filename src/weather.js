// Bedingungen unterwegs: Wetter (Open-Meteo) für die Uhrzeit, zu der man die Abschnitte erreicht,
// plus Sonnenstand (Blendung, Dunkelheit). Open-Meteo: kostenlos für nicht-kommerzielle Nutzung, ohne Schlüssel.
import { buildTrack, pointAt } from './nav.js';
import { sunTimes, glareSegments } from './sun.js';
import { timed } from './telemetry.js';
import { isOnline } from './net.js';

import { CONFIG } from './config.js';

const API = CONFIG.weatherUrl;
const VARS = 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m';
const DAY = 864e5;
const HORIZON = 15 * DAY;        // so weit reicht die Vorhersage zuverlässig
const SAMPLE_EVERY = 15000;      // m zwischen Wetterpunkten
const MAX_SAMPLES = 12;

// Schwellen für Warnungen
export const LIMITS = { rainProb: 60, rainMm: 0.3, gust: 55, cold: 3, hot: 32 };

const WMO = [[0, 'klar'], [3, 'bewölkt'], [48, 'Nebel'], [57, 'Niesel'], [67, 'Regen'], [77, 'Schnee'], [82, 'Schauer'], [86, 'Schneeschauer'], [99, 'Gewitter']];
export const weatherText = code => (WMO.find(([max]) => code <= max) || [0, '–'])[1];

const cache = new Map(); // Anfrage-URL -> { t, data }, 30 Minuten
async function fetchForecast(points, days) {
  const url = `${API}?latitude=${points.map(p => p[0].toFixed(3)).join(',')}&longitude=${points.map(p => p[1].toFixed(3)).join(',')}`
    + `&hourly=${VARS}&timeformat=unixtime&forecast_days=${days}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < 30 * 60e3) return hit.data;
  const res = await timed('Wetter', fetch(url));
  if (!res.ok) throw new Error(`Wetterdienst: HTTP ${res.status}`);
  const json = await res.json(), data = Array.isArray(json) ? json : [json];
  cache.set(url, { t: Date.now(), data });
  return data;
}

// Wetterpunkte entlang der Route mit Ankunftszeit
export function samplePoints(coords, departMs, totalS) {
  const track = buildTrack(coords), n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(track.total / SAMPLE_EVERY) + 1));
  return Array.from({ length: n }, (_, i) => {
    const d = track.total * i / (n - 1);
    return { d, at: departMs + totalS * 1000 * i / (n - 1), p: pointAt(track, d) };
  });
}

const fmtTime = ms => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const km = m => `km ${Math.round(m / 1000)}`;

// Ergebnis: { samples, glare, dark, warnings: [{ kind, text, from, to }], summary, error }
export async function routeConditions(route, departMs) {
  const out = { departMs, samples: [], glare: [], warnings: [], summary: '' };
  const arrive = departMs + route.time * 1000, end = route.coords[route.coords.length - 1], start = route.coords[0];

  // Sonne: offline und ohne Dienst
  out.glare = glareSegments(route.coords, departMs, route.time);
  for (const g of out.glare) out.warnings.push({ kind: 'glare', from: g.from, to: g.to,
    text: `Tief stehende Sonne von vorn: ${km(g.from)}–${Math.max(Math.round(g.to / 1000), Math.round(g.from / 1000) + 1)} (ca. ${fmtTime(g.at)})` });
  const tEnd = sunTimes(arrive, end[0], end[1]), tStart = sunTimes(departMs, start[0], start[1]);
  if (tStart && departMs < tStart.sunrise) out.warnings.push({ kind: 'dark', text: `Abfahrt vor Sonnenaufgang (${fmtTime(tStart.sunrise)})` });
  if (tEnd && arrive > tEnd.sunset) out.warnings.push({ kind: 'dark', text: `Ankunft nach Sonnenuntergang (${fmtTime(tEnd.sunset)})` });

  // Wetter
  out.samples = samplePoints(route.coords, departMs, route.time);
  if (!isOnline()) { out.error = 'Wetter braucht Internet'; return finish(out); }
  if (arrive > Date.now() + HORIZON) { out.error = 'Abfahrt liegt zu weit in der Zukunft für eine Vorhersage'; return finish(out); }
  try {
    const days = Math.min(16, Math.max(1, Math.ceil((arrive - Date.now()) / DAY) + 1));
    const data = await fetchForecast(out.samples.map(s => s.p), days);
    out.samples.forEach((s, i) => {
      const h = data[i]?.hourly;
      if (!h) return;
      let k = 0, best = Infinity; // nächste volle Stunde
      h.time.forEach((t, j) => { const diff = Math.abs(t * 1000 - s.at); if (diff < best) { best = diff; k = j; } });
      if (best > 2 * 3600e3) return; // außerhalb der Vorhersage
      Object.assign(s, { temp: h.temperature_2m[k], prob: h.precipitation_probability[k], mm: h.precipitation[k],
        code: h.weather_code[k], wind: h.wind_speed_10m[k], gust: h.wind_gusts_10m[k] });
    });
  } catch (err) { out.error = err.message; }
  return finish(out);
}

function finish(out) {
  const s = out.samples.filter(x => x.temp != null);
  const rainy = x => x.prob >= LIMITS.rainProb || x.mm >= LIMITS.rainMm || x.code >= 51;
  const first = (test, kind, text) => {
    const i = out.samples.findIndex(x => x.temp != null && test(x));
    if (i < 0) return;
    const to = out.samples.slice(i).findIndex(x => !test(x));
    out.warnings.unshift({ kind, from: out.samples[i].d, to: to < 0 ? out.samples[out.samples.length - 1].d : out.samples[i + to].d,
      text: text(out.samples[i]) });
  };
  first(x => x.code >= 95, 'storm', x => `Gewitter möglich ab ${km(x.d)} (ca. ${fmtTime(x.at)})`);
  first(rainy, 'rain', x => `Regen wahrscheinlich ab ${km(x.d)} (ca. ${fmtTime(x.at)}, ${x.prob} %)`);
  first(x => x.gust >= LIMITS.gust, 'wind', x => `Starke Böen bis ${Math.round(x.gust)} km/h ab ${km(x.d)}`);
  first(x => x.temp <= LIMITS.cold, 'cold', x => `Kalt (${Math.round(x.temp)} °C) – Glätte möglich ab ${km(x.d)}`);
  first(x => x.temp >= LIMITS.hot, 'hot', x => `Hitze (${Math.round(x.temp)} °C) ab ${km(x.d)}`);
  if (s.length) {
    const t = s.map(x => x.temp), gust = Math.max(...s.map(x => x.gust));
    out.summary = `${Math.round(Math.min(...t))}–${Math.round(Math.max(...t))} °C · ${s.some(rainy) ? 'Regen möglich' : 'trocken'} · Böen bis ${Math.round(gust)} km/h`;
  }
  return out;
}
