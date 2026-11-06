// Gespeicherte Routen. Nativ als JSON-Dateien im privaten App-Datenordner, im Browser in IndexedDB.
// Aufbau: ein Index (Liste der Routen-Metadaten) + je Route ein Datensatz mit Plan und Straßendaten.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FEATURE_TAGS } from './features.js';

const native = Capacitor.isNativePlatform();
// Nur was buildGraph und die Merkmale (features.js) brauchen
const TAGS = ['highway', 'name', 'ref', 'oneway', 'junction', ...FEATURE_TAGS];

// ---------- Schlüssel-Wert-Speicher ----------

let dbPromise;
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('kurvenjagd', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, op) {
  const store = (await db()).transaction('kv', mode).objectStore('kv');
  return new Promise((resolve, reject) => {
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Cache-Einträge (Präfix „cache-“) und gefahrene Touren („ride-“) liegen getrennt von den gespeicherten Routen
const folder = key => (key.startsWith('cache-') ? 'cache' : key.startsWith('ride-') ? 'rides' : 'routes');
const file = key => ({ path: `${folder(key)}/${key}.json`, directory: Directory.Data });

async function get(key) {
  if (!native) return idb('readonly', s => s.get(key));
  try { return JSON.parse((await Filesystem.readFile({ ...file(key), encoding: Encoding.UTF8 })).data); }
  catch { return undefined; } // Datei gibt es (noch) nicht
}
async function set(key, value) {
  if (!native) return idb('readwrite', s => s.put(value, key));
  await Filesystem.writeFile({ ...file(key), data: JSON.stringify(value), encoding: Encoding.UTF8, recursive: true });
}
async function del(key) {
  if (!native) return idb('readwrite', s => s.delete(key));
  await Filesystem.deleteFile(file(key)).catch(() => {});
}

// ---------- Cache (Straßendaten-Kacheln) ----------

export const cacheGet = key => get('cache-' + key);
export const cacheSet = (key, value) => set('cache-' + key, value);

export async function cacheKeys() {
  if (!native) return (await idb('readonly', s => s.getAllKeys())).filter(k => String(k).startsWith('cache-'));
  try {
    const { files } = await Filesystem.readdir({ path: 'cache', directory: Directory.Data });
    return files.map(f => (typeof f === 'string' ? f : f.name).replace(/\.json$/, ''));
  } catch { return []; } // Ordner gibt es noch nicht
}

export async function cacheClear() {
  for (const k of await cacheKeys()) await del(k);
}

// ---------- Straßendaten kompakt ablegen ----------

// Overpass-Weg -> [id, Knoten, flache Koordinaten (volle Overpass-Genauigkeit, 7 Stellen), Tags]
// Nicht stärker runden: schon 0,1 m verschieben Kurvigkeitswerte und damit die berechnete Route.
export function packWays(ways) {
  return ways.map(w => [w.id, w.nodes, w.geometry.flatMap(p => [+p.lat.toFixed(7), +p.lon.toFixed(7)]),
    Object.fromEntries(TAGS.filter(t => w.tags?.[t]).map(t => [t, w.tags[t]]))]);
}
export function unpackWays(packed) {
  return packed.map(([id, nodes, flat, tags]) => ({
    type: 'way', id, nodes, tags,
    geometry: nodes.map((_, i) => ({ lat: flat[2 * i], lon: flat[2 * i + 1] })),
  }));
}

// Abbiegeverbote kompakt: [id, relevante Tags, Mitglieder [[Typ-Kürzel, Ref, Rolle]]]
const REL_TAGS = ['type', 'restriction', 'restriction:motorcycle', 'except'];
const MEMBER_TYPE = { w: 'way', n: 'node', r: 'relation' };
export const packRels = rels => rels.map(r => [r.id, Object.fromEntries(REL_TAGS.filter(t => r.tags?.[t]).map(t => [t, r.tags[t]])),
  (r.members || []).map(m => [m.type[0], m.ref, m.role])]);
export const unpackRels = packed => packed.map(([id, tags, members]) => ({
  type: 'relation', id, tags, members: members.map(([t, ref, role]) => ({ type: MEMBER_TYPE[t], ref, role })),
}));

// ---------- Routen ----------

export const listRoutes = async () => (await get('index')) || [];

export async function saveRoute(meta, data) {
  const id = meta.id || Date.now().toString(36);
  await set('route-' + id, data);
  const index = (await listRoutes()).filter(m => m.id !== id);
  index.unshift({ ...meta, id });
  await set('index', index);
  return id;
}

export const loadRoute = id => get('route-' + id);

export async function deleteRoute(id) {
  await del('route-' + id);
  await set('index', (await listRoutes()).filter(m => m.id !== id));
}

// ---------- Gefahrene Touren (Fahrprofil) ----------
// Index mit allem, was das Lernen braucht (Bewertung, Tags, Strecken-Eigenschaften); die GPS-Spur liegt je Tour extra.

export const listRides = async () => (await get('ride-index')) || [];

export async function saveRide(ride) {
  const id = ride.id || Date.now().toString(36);
  const { trace, ...meta } = ride;
  if (trace) await set('ride-' + id, { trace });
  await set('ride-index', [{ ...meta, id }, ...(await listRides()).filter(r => r.id !== id)]);
  return id;
}

export async function updateRide(id, patch) {
  await set('ride-index', (await listRides()).map(r => (r.id === id ? { ...r, ...patch } : r)));
}

export const loadRideTrace = async id => (await get('ride-' + id))?.trace || [];

export async function deleteRide(id) {
  await del('ride-' + id);
  await set('ride-index', (await listRides()).filter(r => r.id !== id));
}
