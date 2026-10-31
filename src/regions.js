// Offline-Regionen: ein ganzes Gebiet (z. B. „Schwarzwald“) einmal herunterladen – Hauptstraßen mit
// Abbiegeverboten, Ortsnamen und Tankstellen (aus den Straßenpaketen) und Höhenmodell (Zoom 11).
// Alles landet angepinnt im Kachel-Cache und verfällt nicht. Danach funktionieren Planen, Navigation
// und die eigene Offline-Karte ohne Netz. Ohne Pakete (nur Entwicklung) wird blockweise Overpass gefragt.
import * as R from './router.js';
import { cacheGet, cacheSet } from './store.js';
import { tilesFor, tileBlock, tileKey, fresh, setPin, fetchAndStore, fetchPackage, downloadDem, demKey, forgetTile, isOnline } from './tiles.js';
import { packages } from './data.js';
import { CONFIG } from './config.js';
import { demTiles } from './dem.js';

// Beliebte Motorrad-Gebiete (grob umrissen)
export const PRESETS = [
  { id: 'schwarzwald', name: 'Schwarzwald', bbox: [47.6, 7.6, 48.9, 8.7] },
  { id: 'alb', name: 'Schwäbische Alb', bbox: [48.1, 8.75, 48.9, 10.3] },
  { id: 'allgaeu', name: 'Allgäu und Bodensee', bbox: [47.3, 9.4, 47.9, 10.9] },
  { id: 'harz', name: 'Harz', bbox: [51.5, 10.2, 52.0, 11.4] },
  { id: 'eifel', name: 'Eifel', bbox: [50.0, 6.2, 50.7, 7.3] },
  { id: 'sauerland', name: 'Sauerland', bbox: [51.0, 7.5, 51.5, 8.8] },
  { id: 'bayerwald', name: 'Bayerischer Wald', bbox: [48.6, 12.5, 49.4, 13.9] },
  { id: 'pfalz', name: 'Pfälzerwald', bbox: [49.0, 7.5, 49.6, 8.2] },
];

const BLOCK = 4;                 // Kacheln je Blockseite (4 × 4 = 0,4° × 0,4°) = ein Fortschritts-Schritt bzw. eine Overpass-Abfrage
const MAX_SPAN = 1.6;            // größter erlaubter Ausschnitt in Grad
const BYTES_PER_TILE = 140e3;    // Erfahrungswert Straßen je 0,1°-Kachel (gepackt)
const BYTES_PER_DEM = 175e3;     // Höhen-Kachel Zoom 11 als Text

export const listRegions = async () => (await cacheGet('regions').catch(() => null)) || [];
const saveIndex = list => cacheSet('regions', list);

// Grobe Größenabschätzung vor dem Download
export function estimate(bbox) {
  const tiles = tilesFor(bbox).length, dem = demTiles(bbox, 11).length;
  return { tiles, dem, blocks: blocksFor(bbox).length, bytes: tiles * BYTES_PER_TILE + dem * BYTES_PER_DEM };
}

// Kacheln eines Rechtecks in Blöcke zu je höchstens BLOCK × BLOCK aufteilen
// (an der Region ausgerichtet, nicht am weltweiten Raster – sonst zerfallen kleine Regionen in viele Stücke)
export function blocksFor(bbox) {
  const tiles = tilesFor(bbox), out = new Map();
  const i0 = Math.min(...tiles.map(t => t[0])), j0 = Math.min(...tiles.map(t => t[1]));
  for (const [i, j] of tiles) {
    const k = `${Math.floor((i - i0) / BLOCK)}_${Math.floor((j - j0) / BLOCK)}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([i, j]);
  }
  return [...out.values()];
}

export function checkBbox([s, w, n, e]) {
  if (n - s > MAX_SPAN || e - w > MAX_SPAN) throw new Error(`Ausschnitt zu groß (max. ${MAX_SPAN}° × ${MAX_SPAN}°). Bitte hineinzoomen.`);
}

// Region herunterladen. force: auch vorhandene Kacheln neu laden (Aktualisieren).
// onProgress({ phase, done, total, text }); signal: AbortSignal zum Abbrechen (Fortsetzen ist jederzeit möglich).
export async function downloadRegion({ id, name, bbox }, { force = false, onProgress = () => {}, signal } = {}) {
  checkBbox(bbox);
  if (!isOnline()) throw new Error('Kein Netz – zum Herunterladen wird Internet gebraucht.');
  const pkg = await packages();
  if (!pkg && !CONFIG.overpassFallback) throw new Error('Straßendaten gerade nicht erreichbar. Bitte später erneut versuchen.');
  const t0 = Date.now(), blocks = blocksFor(bbox), stat = { blocks: blocks.length, fetched: 0, reused: 0, tiles: 0, relations: 0, dem: null, places: 0, source: pkg ? 'Straßenpakete' : 'Overpass' };
  const places = [];
  let index = await listRegions();
  index = [...index.filter(r => r.id !== id), { id, name, bbox, created: index.find(r => r.id === id)?.created || t0, updated: null, complete: false }];
  await saveIndex(index);

  // 1) Straßen blockweise; schon vorhandene, frische Kacheln nur anheften
  for (const [n, tiles] of blocks.entries()) {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    onProgress({ phase: 'Straßen', done: n, total: blocks.length, text: `Straßen: Block ${n + 1} von ${blocks.length}` });
    const entries = await Promise.all(tiles.map(([i, j]) => cacheGet(tileKey(i, j)).catch(() => null)));
    if (!force && entries.every(fresh)) {
      for (const [i, j] of tiles) await setPin(tileKey(i, j), id, true);
      for (const e of entries) places.push(...(e.places || []));
      stat.reused++;
    } else if (pkg) {
      // Paket-Dateien je Kachel (nicht abgedeckte Kacheln, z. B. jenseits der Grenze, bleiben leer)
      for (const [i, j] of tiles.filter(([i, j]) => pkg.tiles.has(tileKey(i, j)))) {
        if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
        const { entry } = await fetchPackage('roads', i, j, id);
        stat.relations += entry.rels.length;
        places.push(...entry.places);
      }
      stat.fetched++;
    } else {
      const block = tileBlock(tiles);
      const { list, rels } = await fetchAndStore({ block, pin: id,
        onProgress: info => onProgress({ phase: 'Straßen', done: n, total: blocks.length, text: `Straßen: Block ${n + 1} von ${blocks.length} · ${info}` }) });
      stat.fetched++; stat.relations += rels.length;
      for (const [i, j] of block.all) forgetTile(i, j);
      if (!list.length) stat.empty = (stat.empty || 0) + 1;
    }
    stat.tiles += tiles.length;
  }

  // 2) Höhenmodell (Zoom 11 reicht für Höhenmeter und Schummerung)
  onProgress({ phase: 'Höhen', done: blocks.length, total: blocks.length + 2, text: 'Höhenmodell …' });
  stat.dem = (await downloadDem(bbox, id, force)).stat;

  // 3) Ortsnamen für die Offline-Karte (mit Paketen schon mitgekommen)
  onProgress({ phase: 'Orte', done: blocks.length + 1, total: blocks.length + 2, text: 'Ortsnamen …' });
  if (pkg) {
    const seen = new Set(), list = places.filter(([name, lat, lon]) => !seen.has(name + lat + lon) && seen.add(name + lat + lon)
      && lat >= bbox[0] && lat <= bbox[2] && lon >= bbox[1] && lon <= bbox[3]);
    await cacheSet(`places-${id}`, list);
    stat.places = list.length;
  } else try {
    const data = await R.overpass(`[out:json][timeout:60];node["place"~"^(city|town|village)$"](${bbox.join(',')});out qt;`, undefined, { record: false });
    const places = data.elements.filter(p => p.tags?.name).map(p => [p.tags.name, +p.lat.toFixed(5), +p.lon.toFixed(5), p.tags.place[0]]);
    await cacheSet(`places-${id}`, places);
    stat.places = places.length;
  } catch { /* Ortsnamen sind verzichtbar */ }

  index = (await listRegions()).map(r => (r.id === id ? { ...r, updated: Date.now(), complete: true, stat, ms: Date.now() - t0 } : r));
  await saveIndex(index);
  onProgress({ phase: 'fertig', done: 1, total: 1, text: 'Fertig' });
  return stat;
}

// Region entfernen: Pins lösen. Kacheln, die keine andere Region mehr braucht, verfallen dann normal.
export async function deleteRegion(id) {
  const index = await listRegions(), region = index.find(r => r.id === id);
  if (!region) return;
  for (const [i, j] of tilesFor(region.bbox)) { await setPin(tileKey(i, j), id, false); forgetTile(i, j); }
  for (const [x, y] of demTiles(region.bbox, 11)) await setPin(demKey(11, x, y), id, false);
  await cacheSet(`places-${id}`, []);
  await saveIndex(index.filter(r => r.id !== id));
}

// Ortsnamen aller Regionen (für die Offline-Karte): [name, lat, lon, Art]
export async function allPlaces() {
  const out = [];
  for (const r of await listRegions()) out.push(...((await cacheGet(`places-${r.id}`).catch(() => null)) || []));
  return out;
}

// Liegt ein Punkt in einer vollständig heruntergeladenen Region?
export async function regionAt([lat, lon]) {
  return (await listRegions()).find(r => r.complete && lat >= r.bbox[0] && lat <= r.bbox[2] && lon >= r.bbox[1] && lon <= r.bbox[3]) || null;
}

