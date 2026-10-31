// Schneidet die eigene Vektorkarte (PMTiles) aus dem aktuellen Protomaps-Weltbau aus.
// Statt fremder Kartenkacheln lädt die App diese eine Datei vom eigenen Speicher (per Range-Anfragen).
//
//   node scripts/build-map.mjs <ausgabe.pmtiles> [--bbox s,w,n,e] [--maxzoom 15]
//
// Standard: D-A-CH bis Zoom 15. Ist das Werkzeug `pmtiles` (go-pmtiles) installiert (PATH oder tools/),
// wird es benutzt – nötig für große Gebiete, z. B. im wöchentlichen Bau (.github/workflows/daten.yml).
// Sonst schneidet dieses Skript selbst aus (Kachel für Kachel, für Testgebiete bis einige tausend Kacheln).
// Daten: © OpenStreetMap-Mitwirkende (ODbL), Kartenschema Protomaps Basemaps.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PMTiles, zxyToTileId } from 'pmtiles';
import { writePmtiles } from './pmtiles-write.mjs';

const DACH = '45.8,5.9,55.1,17.2';
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!out) { console.error('Aufruf: node scripts/build-map.mjs <ausgabe.pmtiles> [--bbox s,w,n,e] [--maxzoom 15]'); process.exit(1); }
const [s, w, n, e] = (opt('--bbox') || DACH).split(',').map(Number);
const maxzoom = +(opt('--maxzoom') || 15);

// Neuester Weltbau im aktuellen Kartenschema (v4, passend zu protomaps-leaflet 5)
const builds = await (await fetch('https://build-metadata.protomaps.dev/builds.json')).json();
const latest = builds.filter(b => String(b.version).startsWith('4.')).at(-1);
if (!latest) throw new Error('Kein Protomaps-Bau mit Schema v4 gefunden');
const source = `https://build.protomaps.com/${latest.key}`;
console.log(`Quelle: ${latest.key} (Schema ${latest.version}), Ausschnitt ${s},${w},${n},${e}, bis Zoom ${maxzoom}`);

const cli = ['pmtiles', join('tools', process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles')].find(c => {
  try { execFileSync(c, ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (cli) {
  execFileSync(cli, ['extract', source, out, `--bbox=${w},${s},${e},${n}`, `--maxzoom=${maxzoom}`], { stdio: 'inherit' });
} else {
  writeFileSync(out, await extract(source, [s, w, n, e], maxzoom));
}
console.log(`Fertig: ${out}`);

// ---------- Ausschneiden ohne Werkzeug (PMTiles-Spezifikation v3) ----------

function tileRange(z, [s, w, n, e]) {
  const N = 2 ** z, x = lon => Math.min(N - 1, Math.floor((lon + 180) / 360 * N));
  const y = lat => { const r = lat * Math.PI / 180; return Math.min(N - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N)); };
  return { x0: x(w), x1: x(e), y0: y(n), y1: y(s) };
}

async function extract(url, bbox, maxz) {
  const src = new PMTiles(url), header = await src.getHeader(), meta = await src.getMetadata();
  const wanted = [];
  for (let z = header.minZoom; z <= Math.min(maxz, header.maxZoom); z++) {
    const { x0, x1, y0, y1 } = tileRange(z, bbox);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) wanted.push([z, x, y]);
  }
  console.log(`${wanted.length} Kacheln …`);
  const tiles = new Map(); // tileId -> Daten (unkomprimiert)
  let done = 0;
  const queue = [...wanted];
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (queue.length) {
      const [z, x, y] = queue.shift();
      const t = await src.getZxy(z, x, y);
      if (t?.data?.byteLength) tiles.set(zxyToTileId(z, x, y), new Uint8Array(t.data));
      if (++done % 500 === 0) console.log(`  ${done} / ${wanted.length}`);
    }
  }));

  const { bytes, unique } = writePmtiles({ tiles, tileType: header.tileType, minZoom: header.minZoom,
    maxZoom: Math.min(maxz, header.maxZoom), bbox, meta: { ...meta, description: `Kurvenjäger-Ausschnitt ${bbox.join(',')} aus ${url}` } });
  console.log(`${tiles.size} Kacheln, ${unique} verschiedene, ${bytes.length / 1e6 | 0} MB`);
  return bytes;
}
