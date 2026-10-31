// Straßendaten und Höhenmodell mit Kachel-Cache laden.
// Quelle sind die eigenen Straßenpakete (scripts/build_data.py, src/data.js): Hauptstraßen mit Abbiegeverboten,
// Ortsnamen und Tankstellen je Kachel (0,1° × 0,1° ≈ 11 × 7,5 km), Nebenstraßen getrennt. Nur beim Entwickeln
// ohne Pakete springen die öffentlichen Overpass-Server ein. Alles landet im Kachel-Cache; Kacheln
// heruntergeladener Regionen sind „angepinnt“ (pins = Regions-IDs) und verfallen nicht.
import * as R from './router.js';
import { cacheGet, cacheSet, packWays, unpackWays, packRels, unpackRels } from './store.js';
import { DEM_URL, demTiles, demZoom, decodeTerrarium, int16ToBase64, base64ToInt16 } from './dem.js';
import { services } from './telemetry.js';
import { isOnline } from './net.js';
import { packages, fetchData } from './data.js';
import { CONFIG } from './config.js';

export const TILE = 0.1;
const LOCAL_CELL = 0.01;                        // Raster für Nebenstraßen-Einträge (~1 km)
const MAX_AGE = 30 * 24 * 3600 * 1000;          // OSM ändert sich langsam: 30 Tage reichen
const DEM_MAX_AGE = 365 * 24 * 3600 * 1000;     // Gelände ändert sich praktisch nie
// Erhöhen, wenn sich ändert, was gespeichert wird (v2: Tags für Merkmale, v3: Abbiegeverbote)
const CACHE_VERSION = 3;

export const tileKey = (i, j) => `t${i}_${j}`;
const localTileKey = (i, j) => `L${i}_${j}`; // Nebenstraßen einer Paket-Kachel
const localKey = ([lat, lon]) => `l${Math.round(lat / LOCAL_CELL)}_${Math.round(lon / LOCAL_CELL)}`;
const pinned = entry => !!entry?.pins?.length;
export const fresh = entry => !!entry && entry.v === CACHE_VERSION && (pinned(entry) || Date.now() - entry.t < MAX_AGE);
const demFresh = entry => !!entry && (pinned(entry) || Date.now() - entry.t < DEM_MAX_AGE);
// Paket-Kachel, von der es inzwischen einen neueren Bau gibt (angepinnte erst beim Aktualisieren der Region)
const outdated = (entry, pkg) => entry?.src === 'pkg' && pkg && !pinned(entry) && entry.built < pkg.manifest.built;
const valid = w => w.type === 'way' && w.geometry?.length === w.nodes?.length && w.geometry.every(Boolean);
const MAIN_RE = new RegExp(`^(${R.MAIN_ROADS})$`);
export { isOnline };

// Alle Kacheln, die ein Rechteck [s, w, n, e] berührt
export function tilesFor([s, w, n, e]) {
  const out = [];
  for (let i = Math.floor(s / TILE); i <= Math.floor(n / TILE); i++)
    for (let j = Math.floor(w / TILE); j <= Math.floor(e / TILE); j++) out.push([i, j]);
  return out;
}

// Rechteck, das genau die angegebenen Kacheln abdeckt, und alle Kacheln darin
export function tileBlock(tiles) {
  const is = tiles.map(t => t[0]), js = tiles.map(t => t[1]);
  const [i0, i1, j0, j1] = [Math.min(...is), Math.max(...is), Math.min(...js), Math.max(...js)];
  const all = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) all.push([i, j]);
  return { rect: [i0 * TILE, j0 * TILE, (i1 + 1) * TILE, (j1 + 1) * TILE], all };
}

// Wege auf Kacheln verteilen. Ein Weg über eine Kachelgrenze landet in jeder berührten Kachel.
export function splitToTiles(ways, tiles) {
  const buckets = new Map(tiles.map(([i, j]) => [tileKey(i, j), []]));
  for (const w of ways) {
    if (!valid(w)) continue;
    let s = 90, n = -90, we = 180, e = -180;
    for (const { lat, lon } of w.geometry) { if (lat < s) s = lat; if (lat > n) n = lat; if (lon < we) we = lon; if (lon > e) e = lon; }
    for (const [i, j] of tilesFor([s, we, n, e])) buckets.get(tileKey(i, j))?.push(w);
  }
  return buckets;
}

// Relationen (Abbiegeverbote) gehören zu jeder Wege-Liste, die eines ihrer Mitglieder enthält
function relsFor(rels, ways) {
  const ids = new Set(ways.map(w => w.id));
  return rels.filter(r => r.members?.some(m => m.type === 'way' && ids.has(m.ref)));
}

// Eintrag speichern; Pins (Regionen) eines vorhandenen Eintrags bleiben erhalten
async function store(key, entry, pin) {
  const old = await cacheGet(key).catch(() => null);
  const pins = [...new Set([...(old?.pins || []), ...(pin ? [pin] : [])])];
  await cacheSet(key, { ...entry, ...(pins.length ? { pins } : {}) }).catch(() => {});
}

// Region an einen vorhandenen Eintrag heften (ohne neu zu laden) bzw. wieder lösen
export async function setPin(key, pin, on) {
  const entry = await cacheGet(key).catch(() => null);
  if (!entry) return false;
  const pins = new Set(entry.pins || []);
  if (on) pins.add(pin); else pins.delete(pin);
  await cacheSet(key, { ...entry, pins: [...pins] }).catch(() => {});
  return true;
}

async function findLocal(p) {
  const [ci, cj] = localKey(p).slice(1).split('_').map(Number);
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      const entry = await cacheGet(`l${ci + di}_${cj + dj}`).catch(() => null);
      if (fresh(entry) && R.haversine(p, entry.center) < R.LOCAL_RADIUS * 0.8) return entry;
    }
  return null;
}

// ---------- Höhenmodell ----------

// PNG laden und dekodieren (Canvas im Haupt-Thread)
async function fetchDemTile(z, x, y) {
  const res = await fetch(DEM_URL(z, x, y));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return decodeTerrarium(ctx.getImageData(0, 0, 256, 256).data);
}

export const demKey = (z, x, y) => `d${z}_${x}_${y}`;

// Höhen-Kachel für die Anzeige (Geländeschattierung): aus dem Cache, sonst online laden, ohne zu speichern
export async function demTile(z, x, y) {
  const cached = await cachedDemTile(z, x, y);
  if (cached || !isOnline()) return cached;
  try { return await fetchDemTile(z, x, y); } catch { return null; }
}
export async function cachedDemTile(z, x, y) {
  const entry = await cacheGet(demKey(z, x, y)).catch(() => null);
  return demFresh(entry) ? base64ToInt16(entry.h) : null;
}

// Höhen-Kacheln bei Zoom z laden: aus dem Cache, sonst (online) von den AWS Terrain Tiles, je 6 parallel.
async function fetchDemSet(rect, z, { pin, onlyCache = false, force = false } = {}) {
  const list = demTiles(rect, z), dem = { z, tiles: new Map() }, stat = { z, tiles: list.length, cached: 0, loaded: 0, failed: 0 };
  const queue = [...list];
  const run = async () => {
    while (queue.length) {
      const [x, y] = queue.shift(), key = demKey(z, x, y);
      const entry = force ? null : await cacheGet(key).catch(() => null);
      if (demFresh(entry)) {
        dem.tiles.set(`${x}/${y}`, base64ToInt16(entry.h)); stat.cached++;
        if (pin && !entry.pins?.includes(pin)) await setPin(key, pin, true);
        continue;
      }
      if (onlyCache) { stat.failed++; continue; }
      try {
        const h = await fetchDemTile(z, x, y);
        dem.tiles.set(`${x}/${y}`, h);
        stat.loaded++;
        await store(key, { t: Date.now(), h: int16ToBase64(h) }, pin);
      } catch { stat.failed++; }
    }
  };
  await Promise.all(Array.from({ length: 6 }, run));
  return { dem, stat };
}

// Höhenmodell für ein Rechteck. Fehlende Kacheln sind kein Fehler – dort gibt es dann einfach keine
// Höhenmeter. Offline (oder wenn Kacheln fehlen) wird auf Zoom 11 aus dem Cache ausgewichen,
// den heruntergeladene Regionen mitbringen.
export async function loadDem(rect) {
  const t0 = performance.now(), z = demZoom(rect), online = isOnline();
  let { dem, stat } = await fetchDemSet(rect, z, { onlyCache: !online });
  if (stat.failed && z > 11) {
    const alt = await fetchDemSet(rect, 11, { onlyCache: true });
    if (alt.stat.failed < stat.failed * (alt.stat.tiles / stat.tiles)) ({ dem, stat } = alt);
  }
  stat.ms = performance.now() - t0;
  services['Höhendaten'] = { ok: stat.failed === 0, ms: Math.round(stat.ms), at: Date.now(),
    info: `Zoom ${stat.z}: ${stat.cached} aus Cache, ${stat.loaded} geladen${stat.failed ? `, ${stat.failed} fehlen` : ''}` };
  return { dem, stat };
}

// Region: Höhenmodell bei Zoom 11 herunterladen und anheften
export const downloadDem = (rect, pin, force) => fetchDemSet(rect, 11, { pin, force });

// ---------- Straßendaten ----------

// Eine Overpass-Abfrage für einen Kachel-Block und/oder Nebenstraßen-Umkreise; speichert alles im Cache.
// Abbiegeverbote kommen in derselben Abfrage mit (Relationen, die eine der Straßen enthalten).
export async function fetchAndStore({ block = null, needLocal = [], pin = null, onProgress }) {
  const parts = needLocal.map(([lat, lon]) => `way["highway"~"^(${R.MAIN_ROADS}|${R.LOCAL_ROADS})$"]${R.ACCESS}(around:${R.LOCAL_RADIUS},${lat},${lon});`);
  if (block) parts.unshift(`way["highway"~"^(${R.MAIN_ROADS})$"]${R.ACCESS}(${block.rect.map(v => v.toFixed(5)).join(',')});`);
  const data = await R.overpass(
    `[out:json][timeout:180][maxsize:1073741824];(${parts.join('')})->.w;.w out geom qt;rel(bw.w)["type"="restriction"];out body qt;`,
    onProgress);
  const list = data.elements.filter(valid), rels = data.elements.filter(el => el.type === 'relation');
  if (block) {
    // Hauptstraßen deckt die Abfrage im ganzen Block vollständig ab: alle Kacheln darin speichern
    const main = list.filter(w => MAIN_RE.test(w.tags?.highway || ''));
    for (const [key, tileWays] of splitToTiles(main, block.all)) {
      await store(key, { v: CACHE_VERSION, t: Date.now(), ways: packWays(tileWays), rels: packRels(relsFor(rels, tileWays)) }, pin);
    }
  }
  for (const p of needLocal) {
    const near = list.filter(w => w.geometry.some(g => R.haversine(p, [g.lat, g.lon]) < R.LOCAL_RADIUS + 100));
    await store(localKey(p), { v: CACHE_VERSION, t: Date.now(), center: p, ways: packWays(near), rels: packRels(relsFor(rels, near)) }, pin);
  }
  return { list, rels };
}

// ---------- Straßenpakete ----------

// Eine Kachel aus dem Paket holen und wie bisher im Cache ablegen (kind: 'roads' oder 'local')
export async function fetchPackage(kind, i, j, pin) {
  const { json, size } = await fetchData(`${kind}/${tileKey(i, j)}.json.gz`);
  const entry = { v: CACHE_VERSION, t: Date.now(), built: json.built, src: 'pkg', ways: json.ways, rels: json.rels || [],
    ...(kind === 'roads' ? { places: json.places || [], pois: json.pois || [] } : {}) };
  await store(kind === 'roads' ? tileKey(i, j) : localTileKey(i, j), entry, pin);
  forgetTile(i, j);
  return { entry, size };
}

// Mehrere Kacheln parallel (6 gleichzeitig) holen
async function fetchPackages(kind, list, onEach) {
  const queue = [...list], out = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const [i, j] = queue.shift();
      out.push(await fetchPackage(kind, i, j));
      onEach?.(out.length, list.length);
    }
  }));
  return out;
}

// Nebenstraßen rund um die Punkte aus den Paket-Kacheln (gecacht je Kachel, gefiltert auf den Umkreis)
async function localFromPackages(focus, pkg, online, stat) {
  const ways = [], rels = [], near = (p, w) => w.geometry.some(g => R.haversine(p, [g.lat, g.lon]) < R.LOCAL_RADIUS + 100);
  const r = R.LOCAL_RADIUS / 111320;
  for (const p of focus) {
    const lonR = r / Math.cos(p[0] * Math.PI / 180);
    let ok = true;
    for (const [i, j] of tilesFor([p[0] - r, p[1] - lonR, p[0] + r, p[1] + lonR])) {
      if (!pkg.local.has(tileKey(i, j))) continue;
      let entry = await cacheGet(localTileKey(i, j)).catch(() => null);
      if (!fresh(entry) || (online && outdated(entry, pkg))) {
        if (!online) { ok = false; continue; }
        try { entry = (await fetchPackage('local', i, j)).entry; } catch { ok = false; continue; }
      }
      const list = unpackWays(entry.ways).filter(w => near(p, w));
      ways.push(...list);
      rels.push(...relsFor(unpackRels(entry.rels || []), list));
    }
    if (ok) stat.localLoaded++; else stat.localSkipped++;
  }
  return { ways, rels };
}

// bbox: benötigter Ausschnitt (null = nur Nebenstraßen nachladen), focus: Punkte, um die Nebenstraßen nötig sind.
// Liefert Wege + Abbiegeverbote, das abgedeckte Rechteck (an Kacheln ausgerichtet), Höhenmodell und Statistik.
export async function loadArea(bbox, focus, onProgress) {
  const t0 = performance.now(), online = isOnline();
  const els = new Map(), stat = { tilesCached: 0, tilesLoaded: 0, localCached: 0, localLoaded: 0, localSkipped: 0, offline: !online };
  const add = (ways, rels = []) => { for (const w of ways) els.set('w' + w.id, w); for (const r of rels) els.set('r' + r.id, r); };
  const addEntry = entry => add(unpackWays(entry.ways), unpackRels(entry.rels || []));
  let fetched = null, rect = null;

  // Höhenmodell parallel zu den Straßen laden (andere Server, keine Warteschlange)
  const tiles = bbox ? tilesFor(bbox) : [];
  if (bbox) rect = tileBlock(tiles).rect;
  const demPromise = rect ? loadDem(rect).catch(() => null) : Promise.resolve(null);

  const pkg = await packages();
  stat.source = pkg ? 'Straßenpakete' : 'Overpass';

  // 1) Was liegt schon im Cache?
  const missing = [];
  for (const [i, j] of tiles) {
    const entry = await cacheGet(tileKey(i, j)).catch(() => null);
    if (fresh(entry) && !(online && outdated(entry, pkg))) { addEntry(entry); stat.tilesCached++; } else missing.push([i, j]);
  }

  // 2) Mit Paketen: fehlende Kacheln als Dateien holen (CDN, keine Warteschlange), Nebenstraßen ebenso
  if (pkg) {
    const covered = missing.filter(([i, j]) => pkg.tiles.has(tileKey(i, j)));
    const uncovered = missing.filter(([i, j]) => !pkg.tiles.has(tileKey(i, j)));
    if (covered.length && !online) {
      throw new Error(`Offline und dieses Gebiet ist nicht heruntergeladen (${covered.length} Kacheln fehlen). Lade es unter „Offline-Regionen“ herunter.`);
    }
    const inUncovered = ([lat, lon]) => uncovered.some(([i, j]) => Math.floor(lat / TILE) === i && Math.floor(lon / TILE) === j);
    if (uncovered.length && !CONFIG.overpassFallback && focus.some(inUncovered)) {
      throw new Error('Dieses Gebiet ist (noch) nicht abgedeckt. Kurvenjäger hat Straßendaten für Deutschland, Österreich und die Schweiz.');
    }
    let bytes = 0;
    const t1 = performance.now();
    for (const { entry, size } of await fetchPackages('roads', covered, (n, total) => onProgress?.(`Straßenpakete: ${n} von ${total}`))) {
      addEntry(entry); bytes += size;
    }
    stat.tilesLoaded = covered.length;
    stat.uncovered = uncovered.length;
    if (focus.length) { const loc = await localFromPackages(focus, pkg, online, stat); add(loc.ways, loc.rels); }
    if (!uncovered.length || !CONFIG.overpassFallback) {
      const demRes = await demPromise, all = [...els.values()];
      stat.relations = all.filter(el => el.type === 'relation').length;
      R.metrics.load = { at: Date.now(), ms: performance.now() - t0, rounds: 0, servers: [], parseMs: null, elements: all.length,
        winner: covered.length ? 'Straßenpakete' : 'Kachel-Cache', bytes, netMs: performance.now() - t1,
        fromCache: !covered.length, source: 'Straßenpakete', cache: stat, dem: demRes?.stat };
      return { elements: all, rect, stat, dem: demRes?.dem || null };
    }
    // Entwicklung: nicht abgedeckte Kacheln (Rand des Testgebiets) über Overpass ergänzen
    missing.splice(0, missing.length, ...uncovered);
    focus = [];
  }

  let needLocal = [];
  for (const p of focus) {
    const entry = await findLocal(p);
    if (entry) { addEntry(entry); stat.localCached++; } else needLocal.push(p);
  }

  // Offline: Hauptstraßen müssen da sein (heruntergeladene Region); Nebenstraßen sind verzichtbar –
  // Punkte rasten dann auf die nächste Hauptstraße ein.
  if (missing.length && !online) {
    throw new Error(`Offline und dieses Gebiet ist nicht heruntergeladen (${missing.length} Kacheln fehlen). Lade es unter „Offline-Regionen“ herunter.`);
  }
  if (needLocal.length && !online) { stat.localSkipped = needLocal.length; needLocal = []; }

  // 3) Ohne Pakete (nur Entwicklung): alles Fehlende in EINER Overpass-Anfrage. Die Wartezeit steckt vor allem in der
  //    Warteschlange des Servers, nicht in der Datenmenge – zwei Anfragen hießen doppelt warten.
  if ((missing.length || needLocal.length) && !CONFIG.overpassFallback) {
    throw new Error('Keine Straßendaten erreichbar. Bitte später erneut versuchen.');
  }
  if (missing.length || needLocal.length) {
    const block = missing.length ? tileBlock(missing) : null;
    const label = [block && `${missing.length} Kacheln`, needLocal.length && `${needLocal.length} Umkreise`].filter(Boolean).join(' + ');
    try {
      const { list, rels } = await fetchAndStore({ block, needLocal, onProgress: info => onProgress?.(`${label} aus dem Netz · ${info}`) });
      fetched = { ...R.metrics.load };
      add(list, rels);
      if (block) stat.tilesLoaded = block.all.length;
      stat.localLoaded = needLocal.length;
    } catch (err) {
      if (block) throw err;                 // ohne Hauptstraßen geht es nicht
      stat.localSkipped = needLocal.length; // Nebenstraßen fehlen: mit Hauptstraßen weiterrechnen
    }
  }

  const demRes = await demPromise;
  const all = [...els.values()];
  stat.relations = all.filter(el => el.type === 'relation').length;
  // Messwerte für die Boxengasse
  R.metrics.load = fetched
    ? { ...fetched, ms: performance.now() - t0, cache: stat, dem: demRes?.stat }
    : { at: Date.now(), ms: performance.now() - t0, rounds: 0, winner: 'Kachel-Cache', source: stat.source, bytes: 0, parseMs: null, elements: all.length, servers: [], fromCache: true, cache: stat, dem: demRes?.stat };
  return { elements: all, rect, stat, dem: demRes?.dem || null };
}

// ---------- Zugriff für die Offline-Karte ----------

const memo = new Map(); // zuletzt gelesene Kacheln (entpackt), höchstens 60
// { ways, places, pois } einer Kachel aus dem Cache oder null
export async function cachedTile(i, j) {
  const key = tileKey(i, j);
  if (memo.has(key)) { const v = memo.get(key); memo.delete(key); memo.set(key, v); return v; }
  const entry = await cacheGet(key).catch(() => null);
  const tile = fresh(entry) ? { ways: unpackWays(entry.ways), places: entry.places || [], pois: entry.pois || [] } : null;
  memo.set(key, tile);
  if (memo.size > 60) memo.delete(memo.keys().next().value);
  return tile;
}
export const cachedTileWays = async (i, j) => (await cachedTile(i, j))?.ways || null;

// Tankstellen bzw. Rasten (kind 'f' / 'r') im Umkreis aus den Paketen: [{ p, name, city }]; null = keine Pakete
export async function nearbyPois(pos, kind, radius = 8000) {
  const pkg = await packages();
  if (!pkg) return null;
  const r = radius / 111320, lonR = r / Math.cos(pos[0] * Math.PI / 180), out = [];
  for (const [i, j] of tilesFor([pos[0] - r, pos[1] - lonR, pos[0] + r, pos[1] + lonR])) {
    let tile = await cachedTile(i, j);
    if (!tile && pkg.tiles.has(tileKey(i, j)) && isOnline()) {
      try { await fetchPackage('roads', i, j); tile = await cachedTile(i, j); } catch { /* Kachel fehlt: weiter */ }
    }
    for (const [lat, lon, k, name, city] of tile?.pois || []) {
      if (k === kind && R.haversine(pos, [lat, lon]) <= radius) out.push({ p: [lat, lon], name, city });
    }
  }
  return out;
}
export const forgetTile = (i, j) => memo.delete(tileKey(i, j));
