// Straßenpakete vom eigenen Speicher (scripts/build_data.py): Manifest und Dateien je 0,1°-Kachel.
// Dateien dürfen gzip-komprimiert ankommen, mit oder ohne Content-Encoding-Header (CDN, Python-Testserver, APK).
import { gunzipSync } from 'fflate';
import { CONFIG } from './config.js';
import { cacheGet, cacheSet } from './store.js';
import { services } from './telemetry.js';
import { isOnline } from './net.js';

const FORMAT = 1;            // passend zu FORMAT in scripts/build_data.py
const MANIFEST_TTL = 6 * 3600e3;

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') return gunzipSync(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// JSON-Datei relativ zur Daten-Adresse laden; liefert auch die übertragene Größe
export async function fetchData(path, { signal } = {}) {
  const res = await fetch(CONFIG.dataUrl + path, { signal });
  if (!res.ok) throw Object.assign(new Error(`Straßenpaket ${path}: HTTP ${res.status}`), { status: res.status });
  let bytes = new Uint8Array(await res.arrayBuffer());
  const size = bytes.length;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  return { json: JSON.parse(new TextDecoder().decode(bytes)), size };
}

// Manifest: welche Kacheln es gibt und wie alt sie sind. Einmal je Sitzung (bzw. alle 6 h) neu geladen,
// offline aus dem Speicher. null = keine Pakete verfügbar (Entwicklung ohne www/data → Overpass).
let current = null, pending = null;
export function packages() {
  if (current && Date.now() - current.at < MANIFEST_TTL) return Promise.resolve(current);
  return (pending ||= load().finally(() => { pending = null; }));
}
async function load() {
  const t0 = performance.now();
  let manifest = null, error = null;
  if (isOnline()) {
    try {
      manifest = (await fetchData('manifest.json')).json;
      if (manifest.v !== FORMAT) throw new Error(`Paketformat ${manifest.v}, erwartet ${FORMAT} – App aktualisieren`);
      await cacheSet('pkg-manifest', manifest).catch(() => {});
    } catch (err) { error = err; manifest = null; }
  }
  if (!manifest) manifest = await cacheGet('pkg-manifest').catch(() => null);
  if (!manifest) {
    services['Straßenpakete'] = { ok: false, ms: Math.round(performance.now() - t0), at: Date.now(), info: error?.message || 'keine Pakete' };
    current = null;
    return null;
  }
  current = { manifest, tiles: new Set(manifest.tiles), local: new Set(manifest.local), at: Date.now() };
  services['Straßenpakete'] = { ok: true, ms: Math.round(performance.now() - t0), at: Date.now(),
    info: `Stand ${new Date(manifest.osm || manifest.built).toLocaleDateString('de-DE')} · ${manifest.tiles.length} Kacheln${error ? ' · aus dem Speicher' : ''}` };
  return current;
}
