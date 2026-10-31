// Höhenmodell (DEM) aus den öffentlichen AWS Terrain Tiles (Terrarium-Kodierung, Quelle: Mapzen/Tilezen).
// Eine Kachel ist ein PNG mit 256 × 256 Pixeln: Höhe = R × 256 + G + B / 256 − 32768 (Meter).
// Dieses Modul rechnet nur (ohne DOM) und läuft im Haupt-Thread und im Worker; das Dekodieren
// der PNGs passiert in tiles.js (braucht Canvas).

export const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const SIZE = 256;

// Web-Mercator: Koordinate -> globale Pixelposition bei Zoom z
export function project(lat, lon, z) {
  const n = SIZE * 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}

// Kacheln (x, y) bei Zoom z, die ein Rechteck [s, w, n, e] abdecken
export function demTiles([s, w, n, e], z) {
  const [x0, y0] = project(n, w, z), [x1, y1] = project(s, e, z), out = [];
  for (let x = Math.floor(x0 / SIZE); x <= Math.floor(x1 / SIZE); x++)
    for (let y = Math.floor(y0 / SIZE); y <= Math.floor(y1 / SIZE); y++) out.push([x, y]);
  return out;
}

// Zoom 12 (~25 m Raster in Mitteleuropa), bei großen Gebieten 11, damit die Datenmenge klein bleibt
export const demZoom = bbox => (demTiles(bbox, 12).length <= 48 ? 12 : 11);

// RGBA-Pixel (Canvas) -> Höhen in ganzen Metern
export function decodeTerrarium(rgba) {
  const out = new Int16Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - 32768);
  return out;
}

// dem = { z, tiles: Map("x/y" -> Int16Array) }. Höhe mit bilinearer Interpolation, NaN ohne Daten.
export function elevAt(dem, lat, lon) {
  const [px, py] = project(lat, lon, dem.z);
  const x = px - 0.5, y = py - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const h = (gx, gy) => {
    const t = dem.tiles.get(`${Math.floor(gx / SIZE)}/${Math.floor(gy / SIZE)}`);
    return t ? t[((gy % SIZE) + SIZE) % SIZE * SIZE + ((gx % SIZE) + SIZE) % SIZE] : NaN;
  };
  return h(x0, y0) * (1 - fx) * (1 - fy) + h(x0 + 1, y0) * fx * (1 - fy) + h(x0, y0 + 1) * (1 - fx) * fy + h(x0 + 1, y0 + 1) * fx * fy;
}

const R_EARTH = 6371000, D2R = Math.PI / 180;
const dist = (a, b) => {
  const dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R * Math.cos((a[0] + b[0]) / 2 * D2R);
  return R_EARTH * Math.hypot(dLat, dLon);
};

// Höhenprofil einer Linie: alle `step` Meter eine Höhe (geglättet gegen Raster-Rauschen)
export function profile(dem, geom, step = 30) {
  const pts = [geom[0]];
  let carry = 0;
  for (let i = 1; i < geom.length; i++) {
    const seg = dist(geom[i - 1], geom[i]);
    let d = step - carry;
    for (; d <= seg; d += step) {
      const t = d / seg;
      pts.push([geom[i - 1][0] + (geom[i][0] - geom[i - 1][0]) * t, geom[i - 1][1] + (geom[i][1] - geom[i - 1][1]) * t]);
    }
    carry = seg - (d - step);
  }
  pts.push(geom[geom.length - 1]);
  const raw = pts.map(([la, lo]) => elevAt(dem, la, lo));
  // gleitender Mittelwert über 3 Punkte
  return raw.map((h, i) => (i === 0 || i === raw.length - 1 ? h : (raw[i - 1] + h + raw[i + 1]) / 3));
}

export const STEEP_GRADE = 8; // % – ab hier zählt ein Stück als steil

// Anstieg und Gefälle (in Zeichenrichtung), größte Steigung und der Anteil der Strecke, der steiler als
// STEEP_GRADE ist (je über ~90 m gemessen, richtungsunabhängig). Der Anteil ist robuster als die größte
// Steigung: Einzelne Ausreißer im Höhenraster machen so nicht gleich die ganze Kante „steil“.
export function edgeElevation(dem, geom, len) {
  const h = profile(dem, geom);
  if (h.some(Number.isNaN) || h.length < 2) return null;
  let up = 0, down = 0, maxGrade = 0, steepN = 0, n = 0;
  for (let i = 1; i < h.length; i++) { const d = h[i] - h[i - 1]; if (d > 0) up += d; else down -= d; }
  const step = len / (h.length - 1), w = Math.max(1, Math.round(90 / (step || 30)));
  for (let i = w; i < h.length; i++) {
    const grade = Math.abs(h[i] - h[i - w]) / (w * step) * 100;
    maxGrade = Math.max(maxGrade, grade);
    n++; if (grade >= STEEP_GRADE) steepN++;
  }
  if (!n) { maxGrade = Math.abs(h[h.length - 1] - h[0]) / (len || 1) * 100; n = 1; steepN = maxGrade >= STEEP_GRADE ? 1 : 0; }
  return { up, down, maxGrade, steepShare: steepN / n, start: h[0], end: h[h.length - 1] };
}

// Höhenkacheln kompakt als Text speichern (Cache, gespeicherte Routen)
export function int16ToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToInt16(b64) {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
