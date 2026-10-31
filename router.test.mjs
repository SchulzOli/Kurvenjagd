// node --test   (synthetische Straßen, kein Netz nötig)
import test from 'node:test';
import assert from 'node:assert/strict';
import { curviness, buildGraph, costArray, dijkstra, summarize, snapToRoad, haversine, routeVia, toGPX } from './src/router.js';

const LAT0 = 48, LON0 = 8;
const toLL = ([x, y]) => [LAT0 + y / 110540, LON0 + x / (111320 * Math.cos(LAT0 * Math.PI / 180))];
const arc = (r, deg) => Array.from({ length: deg + 1 }, (_, i) => toLL([r * Math.cos(i * Math.PI / 180), r * Math.sin(i * Math.PI / 180)]));

test('gerade Straße hat Kurvigkeit 0', () => {
  assert.equal(curviness([toLL([0, 0]), toLL([500, 0]), toLL([1000, 0])]), 0);
});

test('Kurvigkeit folgt dem Radius', () => {
  const tight = curviness(arc(40, 180)), medium = curviness(arc(120, 90)), wide = curviness(arc(500, 30));
  assert.ok(Math.abs(tight - 0.8) < 0.05, `r=40m -> ${tight}`);
  assert.ok(Math.abs(medium - 0.35) < 0.05, `r=120m -> ${medium}`);
  assert.equal(wide, 0);
});

// Zwei Wege von Knoten 1 nach 2: gerade (1 km) und eine Schlangenlinie (~1.4 km)
function twoRoads(extraTags = {}) {
  const straight = [[0, 0], [500, 0], [1000, 0]].map(toLL);
  const snake = Array.from({ length: 201 }, (_, i) => { const x = i * 5; return toLL([x, 30 * Math.sin(2 * Math.PI * x / 125)]); });
  const way = (id, pts, tags) => ({
    type: 'way', id, tags: { highway: 'tertiary', ...tags },
    nodes: pts.map((_, i) => i === 0 ? 1 : i === pts.length - 1 ? 2 : id * 1000 + i),
    geometry: pts.map(([lat, lon]) => ({ lat, lon })),
  });
  return buildGraph({ elements: twoRoads.raw(extraTags) });
}
// Rohdaten im Overpass-Format (auch für den Speichertest)
twoRoads.raw = (extraTags = {}) => {
  const straight = [[0, 0], [500, 0], [1000, 0]].map(toLL);
  const snake = Array.from({ length: 201 }, (_, i) => { const x = i * 5; return toLL([x, 30 * Math.sin(2 * Math.PI * x / 125)]); });
  const way = (id, pts, tags) => ({
    type: 'way', id, tags: { highway: 'tertiary', ...tags },
    nodes: pts.map((_, i) => i === 0 ? 1 : i === pts.length - 1 ? 2 : id * 1000 + i),
    geometry: pts.map(([lat, lon]) => ({ lat, lon })),
  });
  return [way(1, straight, extraTags), way(2, snake, extraTags)];
};

const route = (g, curvy, from = 0, to = 1) =>
  summarize(g, dijkstra(g, from, to, costArray(g, { curvy, avoidHighway: true })));

test('ohne Kurvenlust gerade, mit Kurvenlust Schlangenlinie', () => {
  const g = twoRoads();
  assert.equal(g.edges.length, 2);
  const fast = route(g, 0), curvy = route(g, 1);
  assert.ok(fast.len < 1010 && fast.avgCurv === 0);
  assert.ok(curvy.len > 1300 && curvy.avgCurv > 0.5, JSON.stringify({ len: curvy.len, c: curvy.avgCurv }));
});

test('Einbahnstraßen werden respektiert', () => {
  const g = twoRoads({ oneway: 'yes' });
  assert.ok(dijkstra(g, 0, 1, costArray(g, { curvy: 0 })));
  assert.equal(dijkstra(g, 1, 0, costArray(g, { curvy: 0 })), null);
});

test('Punkt rastet mitten auf der Straße ein, nicht an der Kreuzung', () => {
  const g = twoRoads({ oneway: 'yes' });
  const click = toLL([300, -15]); // 15 m neben der geraden Straße
  const v = snapToRoad(g, click, { avoidHighway: true });
  assert.ok(haversine(click, [g.lat[v], g.lon[v]]) < 16);
  const toSnap = summarize(g, dijkstra(g, 0, v, costArray(g, { curvy: 0 })));
  assert.ok(Math.abs(toSnap.len - 300) < 2, `Länge bis Einrastpunkt ${toSnap.len}`);
  assert.equal(dijkstra(g, v, 0, costArray(g, { curvy: 0 })), null, 'Einbahnstraße bleibt Einbahnstraße');
  assert.equal(snapToRoad(g, click, { avoidHighway: true }), v, 'zweites Einrasten nutzt denselben Knoten');
});

test('Zwischenstopp erzwingt den Weg über den Stopp', () => {
  const g = twoRoads();
  const via = toLL([531.25, 32]); // 2 m neben einem Scheitel der Schlangenlinie
  const { route, snapped } = routeVia(g, [toLL([0, 0]), via, toLL([1000, 0])], { curvy: 0, maxDetour: 3, avoidHighway: true });
  assert.equal(snapped.length, 3);
  assert.ok(route.len > 1300, `Route muss über die Schlangenlinie: ${route.len}`);
  assert.ok(route.coords.some(c => haversine(c, via) < 5), 'Route führt am Stopp vorbei');
});

test('GPX enthält Wegpunkte für Start, Stopps und Ziel', () => {
  const gpx = toGPX([[48, 8], [48.1, 8.1]], 'Test & Tour', [{ lat: 48, lon: 8, name: 'Start' }, { lat: 48.05, lon: 8.05, name: 'Stopp 1' }]);
  assert.equal((gpx.match(/<wpt /g) || []).length, 2);
  assert.match(gpx, /Test &amp; Tour/);
});

test('Gespeicherte Straßendaten ergeben dieselbe Route', async () => {
  const { packWays, unpackWays } = await import('./src/store.js');
  // Koordinaten wie bei Overpass auf 7 Nachkommastellen; dafür muss das Speichern verlustfrei sein
  const ways = twoRoads.raw().map(w => ({ ...w, geometry: w.geometry.map(p => ({ lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) })) }));
  const restored = unpackWays(JSON.parse(JSON.stringify(packWays(ways))));
  const a = route(buildGraph({ elements: ways }), 1), b = route(buildGraph({ elements: restored }), 1);
  assert.equal(b.len, a.len);
  assert.equal(b.avgCurv, a.avgCurv);
});
