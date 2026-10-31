// node --test   (Rechenkern, Kachel-Cache-Logik, Umweg-Binärsuche)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './src/engine-core.js';
import { tilesFor, splitToTiles, tileKey, TILE } from './src/tiles.js';
import { buildGraph, routeVia, metrics } from './src/router.js';

const LAT0 = 48, LON0 = 8;
const toLL = ([x, y]) => [LAT0 + y / 110540, LON0 + x / (111320 * Math.cos(LAT0 * Math.PI / 180))];
const way = (id, pts, nodes) => ({ type: 'way', id, tags: { highway: 'tertiary', name: `Straße ${id}` }, nodes,
  geometry: pts.map(toLL).map(([lat, lon]) => ({ lat, lon })) });
// gerade Straße (1 km) und Schlangenlinie (~1,4 km) zwischen denselben Knoten
const snake = Array.from({ length: 201 }, (_, i) => [i * 5, 30 * Math.sin(2 * Math.PI * i * 5 / 125)]);
const ways = [way(1, [[0, 0], [500, 0], [1000, 0]], [1, 11, 2]), way(2, snake, snake.map((_, i) => i === 0 ? 1 : i === 200 ? 2 : 2000 + i))];

test('Rechenkern liefert klonbare Route mit Kanten-Infos und Manövern', () => {
  const eng = createEngine();
  const { result: net } = eng.handle('setWays', { elements: ways });
  assert.equal(net.edges, 2);
  const { result: r, metrics: m } = eng.handle('route', { points: [toLL([0, 0]), toLL([1000, 0])], mode: 'ab', opt: { curvy: 1, maxDetour: 3, avoidHighway: true } });
  assert.ok(r.route.len > 1300, 'Kurvenroute über die Schlangenlinie');
  assert.ok(r.route.steps.every(s => Array.isArray(s.geom) && typeof s.curv === 'number'));
  assert.equal(r.maneuvers.at(-1).kind, 'goal');
  assert.equal(r.snapped.length, 2);
  assert.doesNotThrow(() => structuredClone(r), 'Ergebnis muss zwischen Threads kopierbar sein');
  assert.ok(m.route.ms >= 0 && m.build.edges === 2);
});

test('Parameter-Änderung erreicht den Rechenkern', () => {
  const eng = createEngine();
  eng.handle('setWays', { elements: ways });
  const opt = { curvy: 1, maxDetour: 3, avoidHighway: true }, pts = [toLL([0, 0]), toLL([1000, 0])];
  eng.handle('setParams', { params: { bonus: 0 }, rebuild: false });   // kein Kurvenbonus mehr
  const r = eng.handle('route', { points: pts, mode: 'ab', opt }).result;
  eng.handle('setParams', { params: { bonus: 0.85 }, rebuild: false });
  assert.ok(r.route.len < 1010, `ohne Bonus gewinnt die gerade Straße (${r.route.len})`);
});

test('Umweg-Limit per Binärsuche: höchstens 5 Läufe, Limit eingehalten', () => {
  const g = buildGraph({ elements: ways });
  const { route } = routeVia(g, [toLL([0, 0]), toLL([1000, 0])], { curvy: 1, maxDetour: 1.2, avoidHighway: true });
  assert.ok(route.len <= 1000 * 1.2 + 1, `Länge ${route.len}`);
  assert.ok(route.curvyUsed < 1);
  assert.ok(metrics.route.trail.length <= 5, `Versuche: ${metrics.route.trail}`);
});

test('Kacheln: Abdeckung und Verteilung über Kachelgrenzen', () => {
  assert.equal(tilesFor([47.95, 7.95, 48.05, 8.05]).length, 4);
  const lat = 48.0, lon = 8.0; // genau auf einer Kachelecke
  const crossing = { type: 'way', id: 9, nodes: [1, 2], geometry: [{ lat: lat - 0.01, lon: lon - 0.01 }, { lat: lat + 0.01, lon: lon + 0.01 }] };
  const inside = { type: 'way', id: 10, nodes: [3, 4], geometry: [{ lat: 48.03, lon: 8.03 }, { lat: 48.04, lon: 8.04 }] };
  const tiles = tilesFor([lat - 0.05, lon - 0.05, lat + 0.05, lon + 0.05]);
  const b = splitToTiles([crossing, inside], tiles);
  const withCrossing = [...b.values()].filter(list => list.includes(crossing)).length;
  assert.equal(withCrossing, 4, 'Weg über die Ecke liegt in allen 4 Kacheln');
  assert.deepEqual(b.get(tileKey(Math.floor(48.03 / TILE), Math.floor(8.03 / TILE))).map(w => w.id).sort((a, b) => a - b), [9, 10]);
});

// ---------- Merkmale (Phase 2) ----------
import { featureRow, FEATURES } from './src/features.js';
import { P, costArray, edgeTime, snapToRoad, edgeFeatures } from './src/router.js';

const idx = key => FEATURES.findIndex(f => f.key === key);

test('Merkmale aus OSM-Tags; fehlende Tags sind neutral', () => {
  const none = featureRow({ highway: 'tertiary' });
  assert.ok(none.values.every(v => v === 0) && none.known === 0);
  const r = featureRow({ surface: 'gravel', smoothness: 'bad', maxspeed: 'DE:urban', lanes: '1', tunnel: 'yes' });
  assert.equal(r.values[idx('unpaved')], 1);
  assert.equal(r.values[idx('rough')], 0.7);
  assert.equal(r.values[idx('slow')], 1);
  assert.equal(r.values[idx('narrow')], 1);
  assert.equal(r.values[idx('tunnel')], 1);
  assert.equal(featureRow({ surface: 'asphalt' }).values[idx('unpaved')], 0);
  assert.ok(featureRow({ surface: 'asphalt' }).known & (1 << idx('unpaved')), 'Belag bekannt, aber befestigt');
  assert.equal(featureRow({ maxspeed: '70' }).values[idx('slow')], 0);
});

test('Gewicht „unbefestigt“ lenkt die Route von der Schotter-Schlangenlinie weg', () => {
  const gravel = ways.map(w => (w.id === 2 ? { ...w, tags: { ...w.tags, surface: 'gravel' } } : w));
  const pts = [toLL([0, 0]), toLL([1000, 0])], opt = { curvy: 1, maxDetour: 3, avoidHighway: true };
  const saved = P.weights.unpaved;
  P.weights.unpaved = 0;
  const with0 = routeVia(buildGraph({ elements: gravel }), pts, opt).route.len;
  P.weights.unpaved = 4;
  const with4 = routeVia(buildGraph({ elements: gravel }), pts, opt).route.len;
  P.weights.unpaved = saved;
  assert.ok(with0 > 1300 && with4 < 1010, `ohne Gewicht ${with0}, mit Gewicht ${with4}`);
});

test('Kostenformel mit Gewicht 0 = bisherige Formel (Zeit × Klasse × Kurvenbonus)', () => {
  const g = buildGraph({ elements: ways });
  const saved = { ...P.weights };
  for (const k in P.weights) P.weights[k] = 0;
  for (const curvy of [0, 0.5, 1]) {
    const c = costArray(g, { curvy, avoidHighway: true });
    g.edges.forEach((e, i) => {
      const old = edgeTime(e) * (1 + ((P.roadFactor.tertiary) - 1) * curvy) * (1 - P.bonus * curvy * Math.min(1, e.curv / P.curveSat));
      assert.ok(Math.abs(c[i] - old) < 1e-9, `Kante ${i}: ${c[i]} vs ${old}`);
    });
  }
  Object.assign(P.weights, saved);
});

test('Einrasten teilt die Kante und vererbt die Merkmale', () => {
  const tagged = ways.map(w => (w.id === 1 ? { ...w, tags: { ...w.tags, surface: 'sett' } } : w));
  const g = buildGraph({ elements: tagged });
  const before = g.edges.length;
  snapToRoad(g, toLL([300, -5]), { avoidHighway: true });
  assert.equal(g.edges.length, before + 2);
  assert.deepEqual(edgeFeatures(g, before), { cobble: 1 });
  assert.deepEqual(edgeFeatures(g, before + 1), { cobble: 1 });
  assert.equal(g.col.dead[0], 1);
});

// ---------- Abbiegeverbote (Phase 3) ----------
import { project } from './src/dem.js';

// T-Kreuzung bei C(500,0): Weg 1 West→C, Weg 2 C→Ost, Weg 3 C→Nord, Weg 4 Ost→Nord (Umfahrung)
function crossing(restriction) {
  const els = [
    way(1, [[0, 0], [250, 0], [500, 0]], [10, 11, 20]),
    way(2, [[500, 0], [750, 0], [1000, 0]], [20, 21, 30]),
    way(3, [[500, 0], [500, 250], [500, 500]], [20, 22, 40]),
    way(4, [[1000, 0], [750, 250], [500, 500]], [30, 23, 40]),
  ];
  if (restriction) els.push({ type: 'relation', id: 99, tags: { type: 'restriction', restriction },
    members: [{ type: 'way', ref: 1, role: 'from' }, { type: 'node', ref: 20, role: 'via' }, { type: 'way', ref: restriction.startsWith('only') ? 2 : 3, role: 'to' }] });
  return els;
}
const fast = { curvy: 0, maxDetour: 5, avoidHighway: true };
const westToNorth = [toLL([0, 0]), toLL([500, 500])];

test('ohne Verbot: direkt links abbiegen', () => {
  const r = routeVia(buildGraph({ elements: crossing() }), westToNorth, fast).route;
  assert.ok(Math.abs(r.len - 1000) < 5, `Länge ${r.len}`);
});

test('no_left_turn: Route umfährt das verbotene Abbiegen', () => {
  const g = buildGraph({ elements: crossing('no_left_turn') });
  assert.equal(g.turn.used, 1);
  const r = routeVia(g, westToNorth, fast).route;
  assert.ok(r.len > 1650, `muss über Ost und die Umfahrung: ${r.len}`);
  assert.ok(metrics.route.arcSearches >= 1, 'zweite Suchstufe wurde gebraucht');
});

test('only_straight_on: auch Abbiegen nach Norden ist verboten', () => {
  const r = routeVia(buildGraph({ elements: crossing('only_straight_on') }), westToNorth, fast).route;
  assert.ok(r.len > 1650, `Länge ${r.len}`);
});

test('Verbot gilt auch, wenn der Start die Kante teilt (Einrasten)', () => {
  const g = buildGraph({ elements: crossing('no_left_turn') });
  const r = routeVia(g, [toLL([200, 8]), toLL([500, 500])], fast).route; // Start mitten auf Weg 1
  assert.ok(r.len > 1350, `Länge ${r.len}`);
});

// ---------- Höhenmodell (Phase 3) ----------
// künstliches Gelände: steigt nach Osten um 5 m je Pixel (~25 m) → ca. 20 % Steigung
function slopeDem(z = 12) {
  const [px0] = project(LAT0, LON0, z), tiles = new Map(), tx0 = Math.floor(px0 / 256);
  const [, py0] = project(LAT0, LON0, z), ty0 = Math.floor(py0 / 256);
  for (let tx = tx0 - 1; tx <= tx0 + 1; tx++) for (let ty = ty0 - 1; ty <= ty0 + 1; ty++) {
    const t = new Int16Array(256 * 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) t[y * 256 + x] = 100 + Math.round((tx * 256 + x - px0) * 5);
    tiles.set(`${tx}/${ty}`, t);
  }
  return { z, tiles };
}

test('Höhenmodell: Anstieg, Gefälle und Merkmal „steil“ je Kante', () => {
  const g = buildGraph({ elements: [way(1, [[0, 0], [500, 0], [1000, 0]], [1, 11, 2])] }, slopeDem());
  const up = g.col.up[0], down = g.col.down[0];
  assert.ok(up > 150 && up < 240 && down < 5, `Anstieg ${up}, Gefälle ${down}`);
  assert.equal(edgeFeatures(g, 0).steep, 1);
  // Route nach Westen: Anstieg und Gefälle vertauscht
  const r = routeVia(g, [toLL([1000, 0]), toLL([0, 0])], fast).route;
  assert.ok(r.down > 150 && r.up < 5, `rückwärts: ↑${r.up} ↓${r.down}`);
});

test('ohne Höhenmodell: keine Höhenmeter, Merkmale neutral', () => {
  const g = buildGraph({ elements: [way(1, [[0, 0], [1000, 0]], [1, 2])] });
  const r = routeVia(g, [toLL([0, 0]), toLL([1000, 0])], fast).route;
  assert.equal(r.up, null);
  assert.deepEqual(edgeFeatures(g, 0), {});
});
