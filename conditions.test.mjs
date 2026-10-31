// node --test   (Sonne, Blendung, Wetter unterwegs, Alternativrouten)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, sunPosition, glareSegments } from './src/sun.js';
import { routeConditions, samplePoints } from './src/weather.js';
import { createEngine } from './src/engine-core.js';

const minutes = (ms, h, m) => Math.abs(ms - Date.UTC(2026, 5, 21, h, m)) / 60e3;

test('Sonnenauf- und -untergang München am 21.06. (±5 min)', () => {
  const t = sunTimes(Date.UTC(2026, 5, 21, 10), 48.137, 11.575);
  assert.ok(minutes(t.sunrise, 3, 13) < 5, new Date(t.sunrise).toISOString()); // 05:13 MESZ
  assert.ok(minutes(t.sunset, 19, 17) < 5, new Date(t.sunset).toISOString()); // 21:17 MESZ
});

test('Sonnenstand: Mittag am Äquator zur Tagundnachtgleiche fast im Zenit', () => {
  assert.ok(sunPosition(Date.UTC(2026, 2, 20, 12, 7), 0, 0).altitude > 88);
});

// 5 km gerade nach Westen bzw. Osten bei 48° N
const line = dir => Array.from({ length: 51 }, (_, i) => [48, 8 + dir * i * 100 / 74600]);

test('Blendung: abends nach Westen ja, nach Osten nein', () => {
  const evening = Date.UTC(2026, 5, 21, 18, 30); // 20:30 MESZ, Sonne tief im Nordwesten/Westen
  assert.ok(glareSegments(line(-1), evening, 600).length >= 1, 'westwärts blendet');
  assert.equal(glareSegments(line(1), evening, 600).length, 0, 'ostwärts nicht');
  assert.equal(glareSegments(line(-1), Date.UTC(2026, 5, 21, 10), 600).length, 0, 'mittags nicht');
});

test('Wetter: Punkte mit Ankunftszeit, Regen-Warnung ab dem richtigen Abschnitt', async () => {
  const coords = line(1), route = { coords, time: 3600 };
  const depart = Math.ceil(Date.now() / 3600e3) * 3600e3 + 3600e3; // nächste volle Stunde + 1 h
  const pts = samplePoints(coords, depart, 3600);
  assert.equal(pts.length, 2);
  assert.equal(pts[1].at - pts[0].at, 3600e3);
  const realFetch = globalThis.fetch;
  // simulierte Open-Meteo-Antwort: am Ende der Strecke (eine Stunde später) regnet es
  globalThis.fetch = async url => {
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    const time = Array.from({ length: 48 }, (_, i) => depart / 1000 - 3600 + i * 3600);
    const h = (i, rain) => ({ time, temperature_2m: time.map(() => 15), precipitation_probability: time.map(t => (rain && t * 1000 >= depart + 3600e3 ? 80 : 10)),
      precipitation: time.map(() => 0), weather_code: time.map(() => 3), wind_speed_10m: time.map(() => 10), wind_gusts_10m: time.map(() => 20) });
    return { ok: true, json: async () => Array.from({ length: n }, (_, i) => ({ hourly: h(i, true) })) };
  };
  try {
    const c = await routeConditions(route, depart);
    const rain = c.warnings.find(w => w.kind === 'rain');
    assert.ok(rain, JSON.stringify(c.warnings));
    assert.match(rain.text, /ab km 4|ab km 5/);
    assert.match(c.summary, /15–15 °C · Regen möglich/);
  } finally { globalThis.fetch = realFetch; }
});

test('Alternativen: zweite kurvige Variante und zügige Route, deutlich verschieden', () => {
  const LAT0 = 48, LON0 = 8, toLL = ([x, y]) => [LAT0 + y / 110540, LON0 + x / (111320 * Math.cos(LAT0 * Math.PI / 180))];
  const way = (id, pts) => ({ type: 'way', id, tags: { highway: 'tertiary' }, nodes: pts.map((_, i) => (i === 0 ? 1 : i === pts.length - 1 ? 2 : id * 1000 + i)),
    geometry: pts.map(toLL).map(([lat, lon]) => ({ lat, lon })) });
  const snake = (amp, side) => Array.from({ length: 201 }, (_, i) => [i * 5, side * (60 + amp * Math.sin(2 * Math.PI * i * 5 / 125)) * Math.sin(Math.PI * i / 200)]);
  const eng = createEngine();
  eng.handle('setWays', { elements: [way(1, [[0, 0], [500, 0], [1000, 0]]), way(2, snake(30, 1)), way(3, snake(25, -1))] });
  const r = eng.handle('route', { points: [toLL([0, 0]), toLL([1000, 0])], mode: 'ab', opt: { curvy: 1, maxDetour: 3, avoidHighway: true, alternatives: true } }).result;
  assert.deepEqual(r.alternatives.map(a => a.key), ['main', 'alt', 'fast']);
  const [main, alt, fast] = r.alternatives;
  assert.ok(alt.overlap < 0.2 && fast.overlap < 0.2, `Überschneidung ${alt.overlap} / ${fast.overlap}`);
  assert.equal(main.label, 'Empfohlen');
  assert.ok(fast.route.time < main.route.time, 'zügige Route ist schneller');
  assert.ok(alt.maneuvers.at(-1).kind === 'goal', 'jede Variante bringt eigene Manöver mit');
});
