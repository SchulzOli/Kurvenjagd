// Schreibt ein PMTiles-Archiv (Spezifikation v3) aus einzelnen Kacheln.
// tiles: Map<tileId, Uint8Array> (unkomprimierte Kacheln, tileId aus zxyToTileId)
import { createHash } from 'node:crypto';
import { gzipSync } from 'fflate';

export function writePmtiles({ tiles, tileType, minZoom, maxZoom, bbox: [s, w, n, e], meta = {} }) {
  // Kacheldaten in Reihenfolge der Tile-ID, gleiche Inhalte (Meer, leere Flächen) nur einmal
  const ids = [...tiles.keys()].sort((a, b) => a - b), seen = new Map(), chunks = [], entries = [];
  let offset = 0;
  for (const id of ids) {
    const gz = gzipSync(tiles.get(id), { level: 9 }), hash = createHash('sha1').update(gz).digest('hex');
    let at = seen.get(hash);
    if (!at) { at = { offset, length: gz.length }; seen.set(hash, at); chunks.push(gz); offset += gz.length; }
    const last = entries.at(-1);
    if (last && last.tileId + last.runLength === id && last.offset === at.offset) last.runLength++;
    else entries.push({ tileId: id, offset: at.offset, length: at.length, runLength: 1 });
  }

  // Verzeichnis: passt es nicht in die ersten 16 KB, kommen Blatt-Verzeichnisse dazu
  let root = gzipSync(directory(entries)), leaves = new Uint8Array(0);
  for (let size = 4096; 127 + root.length > 16384; size *= 2) {
    const leafEntries = [], parts = [];
    let at = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = gzipSync(directory(entries.slice(i, i + size)));
      leafEntries.push({ tileId: entries[i].tileId, offset: at, length: leaf.length, runLength: 0 });
      parts.push(leaf); at += leaf.length;
    }
    root = gzipSync(directory(leafEntries)); leaves = concat(parts);
  }
  const metaBytes = gzipSync(new TextEncoder().encode(JSON.stringify(meta)));
  const data = concat(chunks);

  const h = new DataView(new ArrayBuffer(127));
  new Uint8Array(h.buffer).set(new TextEncoder().encode('PMTiles'), 0);
  h.setUint8(7, 3);
  const u64 = (pos, v) => { h.setUint32(pos, v % 2 ** 32, true); h.setUint32(pos + 4, Math.floor(v / 2 ** 32), true); };
  const rootOff = 127, metaOff = rootOff + root.length, leafOff = metaOff + metaBytes.length, dataOff = leafOff + leaves.length;
  u64(8, rootOff); u64(16, root.length); u64(24, metaOff); u64(32, metaBytes.length);
  u64(40, leafOff); u64(48, leaves.length); u64(56, dataOff); u64(64, data.length);
  u64(72, ids.length); u64(80, entries.length); u64(88, seen.size);
  h.setUint8(96, 1); h.setUint8(97, 2); h.setUint8(98, 2); h.setUint8(99, tileType); // geclustert, gzip, gzip
  h.setUint8(100, minZoom); h.setUint8(101, maxZoom);
  const e7 = v => Math.round(v * 1e7);
  h.setInt32(102, e7(w), true); h.setInt32(106, e7(s), true); h.setInt32(110, e7(e), true); h.setInt32(114, e7(n), true);
  h.setUint8(118, Math.min(10, maxZoom)); h.setInt32(119, e7((w + e) / 2), true); h.setInt32(123, e7((s + n) / 2), true);
  return { bytes: concat([new Uint8Array(h.buffer), root, metaBytes, leaves, data]), tiles: ids.length, unique: seen.size };
}

// Verzeichnis nach Spezifikation: Anzahl, Tile-ID-Differenzen, Lauflängen, Längen, Offsets (0 = direkt dahinter)
function directory(entries) {
  const bytes = [], varint = v => { while (v >= 0x80) { bytes.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); } bytes.push(v); };
  varint(entries.length);
  let last = 0;
  for (const en of entries) { varint(en.tileId - last); last = en.tileId; }
  for (const en of entries) varint(en.runLength);
  for (const en of entries) varint(en.length);
  entries.forEach((en, i) => varint(i > 0 && en.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : en.offset + 1));
  return new Uint8Array(bytes);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
