// node --test   (Manöver und Positionszuordnung)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, routeVia } from './src/router.js';
import { maneuvers, locate, buildTrack } from './src/nav.js';

const LAT0 = 48, LON0 = 8;
const toLL = ([x, y]) => [LAT0 + y / 110540, LON0 + x / (111320 * Math.cos(LAT0 * Math.PI / 180))];
const way = (id, pts, nodes) => ({ type: 'way', id, tags: { highway: 'tertiary', name: `Straße ${id}` }, nodes,
  geometry: pts.map(toLL).map(([lat, lon]) => ({ lat, lon })) });

// T-Kreuzung bei (500,0): West-Ost-Straße und eine Straße nach Norden
const g = buildGraph({ elements: [
  way(1, [[0, 0], [250, 0], [500, 0]], [1, 11, 2]),
  way(2, [[500, 0], [500, 250], [500, 500]], [2, 21, 3]),
  way(3, [[500, 0], [750, 0], [1000, 0]], [2, 31, 4]),
] });
const opt = { curvy: 0, maxDetour: 3, avoidHighway: true };

test('Linksabbiegen an der Kreuzung wird erkannt', () => {
  const { route } = routeVia(g, [toLL([0, 0]), toLL([500, 500])], opt);
  const { list } = maneuvers(g, route);
  const turns = list.filter(m => m.kind === 'turn');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'links abbiegen');
  assert.ok(Math.abs(turns[0].d - 500) < 5, `bei ${turns[0].d} m`);
  assert.match(turns[0].say, /auf Straße 2/);
  assert.equal(list.at(-1).kind, 'goal');
});

test('Geradeaus über die Kreuzung: keine Ansage', () => {
  const { route } = routeVia(g, [toLL([0, 0]), toLL([1000, 0])], opt);
  assert.equal(maneuvers(g, route).list.filter(m => m.kind === 'turn').length, 0);
});

test('Zwischenstopp erzeugt eine Ankunftsmeldung', () => {
  const { route } = routeVia(g, [toLL([0, 0]), toLL([500, 300]), toLL([1000, 0])], opt);
  const stops = maneuvers(g, route).list.filter(m => m.kind === 'stop');
  assert.equal(stops.length, 1);
  assert.ok(Math.abs(stops[0].d - 800) < 5, `Stopp bei ${stops[0].d} m`);
});

test('GPS-Position wird auf die Route projiziert', () => {
  const track = buildTrack([[0, 0], [300, 0], [600, 0]].map(toLL));
  const r = locate(track, toLL([300, 12]), 0);
  assert.ok(Math.abs(r.d - 300) < 1 && Math.abs(r.off - 12) < 1, JSON.stringify(r));
});
