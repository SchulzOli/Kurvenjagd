// node --test   (Straßenpakete und eigene Karte: Bau-Skripte, Format, Laden)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'fflate';
import { PMTiles, zxyToTileId } from 'pmtiles';
import { writePmtiles } from './scripts/pmtiles-write.mjs';
import { unpackWays, unpackRels } from './src/store.js';
import { buildGraph, routeVia } from './src/router.js';

// PMTiles im Speicher lesen
const memSource = bytes => ({ getKey: () => 'mem', getBytes: async (o, l) => ({ data: bytes.slice(o, o + l).buffer }) });

test('PMTiles-Schreiber: Rundlauf, gleiche Kacheln nur einmal gespeichert', async () => {
  const tiles = new Map(), sea = new TextEncoder().encode('meer');
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) tiles.set(zxyToTileId(2, x, y), x === 1 && y === 1 ? new TextEncoder().encode('land 1/1') : sea);
  tiles.set(zxyToTileId(0, 0, 0), new TextEncoder().encode('welt'));
  const { bytes, unique } = writePmtiles({ tiles, tileType: 1, minZoom: 0, maxZoom: 2, bbox: [-80, -180, 80, 180], meta: { name: 'test' } });
  assert.equal(unique, 3);
  const p = new PMTiles(memSource(bytes)), h = await p.getHeader();
  assert.equal(h.maxZoom, 2);
  assert.equal(h.numAddressedTiles, 17);
  const text = async (z, x, y) => new TextDecoder().decode((await p.getZxy(z, x, y)).data);
  assert.equal(await text(0, 0, 0), 'welt');
  assert.equal(await text(2, 1, 1), 'land 1/1');
  assert.equal(await text(2, 3, 3), 'meer');
  assert.equal(await p.getZxy(1, 0, 0), undefined, 'nicht enthaltene Kachel');
  assert.equal((await p.getMetadata()).name, 'test');
});

test('PMTiles-Schreiber: viele Kacheln landen in Blatt-Verzeichnissen', async () => {
  // unregelmäßig verteilte Kacheln mit unterschiedlicher Größe: Verzeichnis lässt sich schlecht komprimieren
  const tiles = new Map(), picked = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = 0; x < 1024 && picked.length < 20000; x++) for (let y = 0; y < 1024; y += 1 + Math.floor(rnd() * 40)) {
    tiles.set(zxyToTileId(10, x, y), new TextEncoder().encode(`${x}/${y}`.padEnd(5 + Math.floor(rnd() * 400), '.')));
    picked.push([x, y]);
  }
  const { bytes } = writePmtiles({ tiles, tileType: 1, minZoom: 10, maxZoom: 10, bbox: [-80, -180, 80, 180] });
  const p = new PMTiles(memSource(bytes)), h = await p.getHeader();
  assert.ok(h.leafDirectoryLength > 0, 'Blatt-Verzeichnisse');
  assert.ok(127 + h.rootDirectoryLength <= 16384, 'Wurzel passt in die ersten 16 KB');
  for (const [x, y] of [picked[0], picked[9999], picked.at(-1)]) assert.ok(new TextDecoder().decode((await p.getZxy(10, x, y)).data).startsWith(`${x}/${y}.`));
});

// Kleiner OSM-Auszug: zwei Landstraßen mit Abbiegeverbot, eine Wohnstraße, eine private Straße, Ort, Tankstelle
const OSM = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  <node id="1" lat="48.051" lon="8.201" version="1"/>
  <node id="2" lat="48.051" lon="8.205" version="1"/>
  <node id="3" lat="48.055" lon="8.205" version="1"/>
  <node id="4" lat="48.051" lon="8.209" version="1"/>
  <node id="5" lat="48.047" lon="8.205" version="1"/>
  <node id="6" lat="48.046" lon="8.210" version="1"/>
  <node id="10" lat="48.052" lon="8.203" version="1"><tag k="place" v="village"/><tag k="name" v="Testdorf"/></node>
  <node id="11" lat="48.050" lon="8.206" version="1"><tag k="amenity" v="fuel"/><tag k="brand" v="Testöl"/></node>
  <way id="100" version="1"><nd ref="1"/><nd ref="2"/><nd ref="4"/><tag k="highway" v="secondary"/><tag k="name" v="L 1"/><tag k="surface" v="asphalt"/><tag k="lit" v="yes"/></way>
  <way id="101" version="1"><nd ref="2"/><nd ref="3"/><tag k="highway" v="tertiary"/></way>
  <way id="102" version="1"><nd ref="2"/><nd ref="5"/><tag k="highway" v="residential"/></way>
  <way id="103" version="1"><nd ref="5"/><nd ref="6"/><tag k="highway" v="tertiary"/><tag k="access" v="private"/></way>
  <relation id="200" version="1"><member type="way" ref="100" role="from"/><member type="node" ref="2" role="via"/><member type="way" ref="101" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation>
</osm>`;

const python = (() => { try { execFileSync('python', ['-c', 'import osmium'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('Paket-Bau aus einem OSM-Auszug: Format passt zur App', { skip: !python && 'python mit pyosmium fehlt' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kj-data-'));
  try {
    writeFileSync(join(dir, 'test.osm'), OSM);
    execFileSync('python', ['scripts/build_data.py', join(dir, 'test.osm'), join(dir, 'out'), '--name', 'Testgebiet'], { stdio: 'pipe' });
    const manifest = JSON.parse(readFileSync(join(dir, 'out', 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.tiles, ['t480_82']);
    assert.equal(manifest.region, 'Testgebiet', 'Gebietsname für die Meldung „nicht abgedeckt“');
    assert.deepEqual(manifest.local, ['t480_82']);
    const roads = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(join(dir, 'out', 'roads', 't480_82.json.gz')))));
    const local = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(join(dir, 'out', 'local', 't480_82.json.gz')))));
    const ways = unpackWays(roads.ways);
    assert.deepEqual(ways.map(w => w.id).sort(), [100, 101], 'private Straße fehlt, Wohnstraße liegt getrennt');
    assert.deepEqual(unpackWays(local.ways).map(w => w.id), [102]);
    const w100 = ways.find(w => w.id === 100);
    assert.deepEqual(w100.nodes, [1, 2, 4]);
    assert.equal(w100.geometry[1].lon, 8.205);
    assert.deepEqual(w100.tags, { highway: 'secondary', name: 'L 1', surface: 'asphalt' }, 'nur Tags, die die App braucht');
    const rels = unpackRels(roads.rels);
    assert.equal(rels[0].tags.restriction, 'no_left_turn');
    assert.deepEqual(rels[0].members.map(m => [m.type, m.ref, m.role]), [['way', 100, 'from'], ['node', 2, 'via'], ['way', 101, 'to']]);
    assert.deepEqual(roads.places, [['Testdorf', 48.052, 8.203, 'v']]);
    assert.deepEqual(roads.pois, [[48.05, 8.206, 'f', 'Testöl', '']]);
    // Das Abbiegeverbot greift im Graphen: von L 1 aus Westen nicht links in die Kreisstraße
    const g = buildGraph({ elements: [...ways, ...rels] });
    assert.equal(g.turn.used, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Straßenpakete laden: gzip mit und ohne Content-Encoding', async () => {
  const realFetch = globalThis.fetch;
  const body = { v: 1, tiles: ['t1_2'], local: [] };
  const gz = gzipSync(new TextEncoder().encode(JSON.stringify(body)));
  try {
    const { fetchData } = await import('./src/data.js');
    globalThis.fetch = async () => new Response(gz);                         // Server ohne Content-Encoding (Testserver, APK)
    assert.deepEqual((await fetchData('manifest.json')).json, body);
    globalThis.fetch = async () => new Response(JSON.stringify(body));       // CDN entpackt schon (Content-Encoding: gzip)
    assert.deepEqual((await fetchData('manifest.json')).json, body);
    globalThis.fetch = async () => new Response('fehlt', { status: 404 });
    await assert.rejects(fetchData('roads/t9_9.json.gz'), /HTTP 404/);
  } finally { globalThis.fetch = realFetch; }
});

test('Testdaten (falls gebaut): Route aus den Paketen', { skip: !existsSync('data/manifest.json') && 'keine Testdaten in data/' }, () => {
  const manifest = JSON.parse(readFileSync('data/manifest.json', 'utf8'));
  const keys = ['t480_81', 't480_82', 't481_81', 't481_82'].filter(k => manifest.tiles.includes(k));
  if (keys.length < 4) return;
  const els = new Map();
  for (const k of keys) {
    const t = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(`data/roads/${k}.json.gz`))));
    for (const w of unpackWays(t.ways)) els.set('w' + w.id, w);
    for (const r of unpackRels(t.rels)) els.set('r' + r.id, r);
  }
  const g = buildGraph({ elements: [...els.values()] });
  const { route } = routeVia(g, [[48.02, 8.12], [48.18, 8.28]], { curvy: 0.8, maxDetour: 2, avoidHighway: true });
  assert.ok(route.len > 15000 && route.len < 60000, `Länge ${route.len}`);
});
