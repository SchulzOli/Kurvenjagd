// Eigene Offline-Karte: zeichnet Schummerung (Höhenmodell), Straßen (Kachel-Cache) und Ortsnamen selbst.
// Dadurch ist die Karte ohne Netz da, und es werden keine fremden Kachelserver vorab leergeladen –
// das verbieten z. B. die Nutzungsregeln der OpenStreetMap-Kachelserver ausdrücklich.
import L from 'leaflet';
import { tilesFor, cachedTile, cachedDemTile, demTile } from './tiles.js';
import { elevAt } from './dem.js';
import { allPlaces } from './regions.js';

// Straßenklasse -> [Farbe, Grundbreite, ab Zoom]
const STYLE = {
  motorway: ['#e8873a', 3, 0], trunk: ['#e8a33a', 2.6, 0], primary: ['#e9c46a', 2.2, 0], secondary: ['#eceae4', 1.7, 0],
  tertiary: ['#b9bdc4', 1.3, 10], unclassified: ['#8e949c', 1.0, 11], residential: ['#6b7079', 0.9, 13], living_street: ['#5a5f68', 0.8, 14],
};
const ORDER = ['living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
const PLACE_ZOOM = { c: 8, t: 10, v: 12 }; // city, town, village
const DEM_Z = 11;

// Kachelkoordinate (Web-Mercator-Pixel) -> Breite/Länge
function unproject(px, py, z) {
  const n = 256 * 2 ** z, lon = px / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * py / n))) * 180 / Math.PI;
  return [lat, lon];
}
function toPx(lat, lon, z) {
  const n = 256 * 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}

// Höhen-Kacheln nach Bedarf aus dem Cache holen: Zoom 11 (Offline-Regionen), sonst Zoom 12 (normaler Planungs-Cache)
const demCache = { 11: new Map(), 12: new Map() };
async function demAt(bounds, z, load = cachedDemTile) {
  const tiles = demCache[z];
  const [x0, y0] = toPx(bounds[2], bounds[1], z).map(v => Math.floor(v / 256));
  const [x1, y1] = toPx(bounds[0], bounds[3], z).map(v => Math.floor(v / 256));
  let found = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const k = `${x}/${y}`;
    if (!tiles.has(k)) tiles.set(k, await load(z, x, y));
    if (tiles.get(k)) found++;
  }
  while (tiles.size > 80) tiles.delete(tiles.keys().next().value);
  return { dem: { z, tiles }, found };
}
async function demFor(bounds) {
  const a = await demAt(bounds, DEM_Z);
  return a.found ? a.dem : (await demAt(bounds, 12)).dem;
}

// Schummerung in 64 × 64 Punkten berechnen und hochskaliert zeichnen (Licht von Nordwest).
// overlay: nur Schatten (schwarz, halbtransparent) zum Überlagern der Vektorkarte
function hillshade(ctx, dem, z, ox, oy, size, overlay = false) {
  const N = 64, img = new ImageData(N, N), step = 256 / N;
  const mpp = 156543.03 * Math.cos(unproject(ox + 128, oy + 128, z)[0] * Math.PI / 180) / 2 ** z * step; // Meter je Rasterpunkt
  const h = new Float32Array((N + 2) * (N + 2));
  for (let y = -1; y <= N; y++) for (let x = -1; x <= N; x++) {
    const [lat, lon] = unproject(ox + (x + 0.5) * step, oy + (y + 0.5) * step, z);
    h[(y + 1) * (N + 2) + x + 1] = elevAt(dem, lat, lon);
  }
  let any = false;
  const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const at = (dx, dy) => h[(y + 1 + dy) * (N + 2) + x + 1 + dx];
    const dzdx = (at(1, 0) - at(-1, 0)) / (2 * mpp), dzdy = (at(0, 1) - at(0, -1)) / (2 * mpp);
    const i = 4 * (y * N + x);
    if (!Number.isFinite(dzdx) || !Number.isFinite(dzdy)) { img.data[i + 3] = 0; continue; }
    any = true;
    const slope = Math.atan(Math.hypot(dzdx, dzdy) * 1.6), aspect = Math.atan2(dzdy, -dzdx);
    const shade = Math.max(0, Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect - Math.PI / 2) + Math.sin(alt) * Math.cos(slope));
    if (overlay) { img.data[i + 3] = Math.round(Math.max(0, 0.78 - shade) * 230); continue; } // Schatten, Rest durchsichtig
    const g = Math.round(18 + shade * 48);
    img.data[i] = g; img.data[i + 1] = g + 2; img.data[i + 2] = g + 4; img.data[i + 3] = 255;
  }
  if (!any) return;
  const small = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N });
  small.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, size, size);
}

// Geländeschattierung als Ebene über der Vektorkarte (Höhenmodell Zoom 12, online nachgeladen)
export function reliefLayer(map) {
  if (!map.getPane('relief')) { const pane = map.createPane('relief'); pane.style.zIndex = 260; pane.style.pointerEvents = 'none'; }
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const ratio = Math.min(2, window.devicePixelRatio || 1), size = 256 * ratio;
      const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
      const { x, y, z } = coords, ox = x * 256, oy = y * 256;
      const [n, w] = unproject(ox, oy, z), [s, e] = unproject(ox + 256, oy + 256, z);
      demAt([s, w, n, e], 12, demTile)
        .then(({ dem }) => { hillshade(canvas.getContext('2d'), dem, z, ox, oy, size, true); done(null, canvas); })
        .catch(err => done(err, canvas));
      return canvas;
    },
  });
  return new Layer({ pane: 'relief', minZoom: 8, maxZoom: 18, opacity: 0.8, attribution: 'Gelände: AWS Terrain Tiles' });
}

export function offlineLayer(map) {
  let places = [];
  if (!map.getPane('offline')) map.createPane('offline').style.zIndex = 250; // eigene Ebene: kein Dunkel-Filter
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const ratio = Math.min(2, window.devicePixelRatio || 1), size = 256 * ratio;
      const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
      draw(canvas, coords, ratio).then(() => done(null, canvas), err => done(err, canvas));
      return canvas;
    },
  });
  const layer = new Layer({ pane: 'offline', minZoom: 8, maxZoom: 18, keepBuffer: 1,
    attribution: '© OpenStreetMap-Mitwirkende · Höhen: AWS Terrain Tiles (SRTM u. a.) · Offline-Karte' });

  async function draw(canvas, { x, y, z }, ratio) {
    const ctx = canvas.getContext('2d'), size = canvas.width, ox = x * 256, oy = y * 256;
    ctx.fillStyle = '#131315'; ctx.fillRect(0, 0, size, size);
    const [n, w] = unproject(ox, oy, z), [s, e] = unproject(ox + 256, oy + 256, z), bounds = [s, w, n, e];
    if (z >= 9) hillshade(ctx, await demFor(bounds), z, ox, oy, size);

    // Straßen (und Ortsnamen der Paket-Kacheln) aus dem Cache, nebensächliche Straßen zuerst
    const byClass = new Map(ORDER.map(c => [c, []]));
    const tilePlaces = [];
    for (const [i, j] of tilesFor(bounds)) {
      const tile = await cachedTile(i, j);
      tilePlaces.push(...(tile?.places || []));
      for (const way of tile?.ways || []) {
        const cls = (way.tags?.highway || '').replace(/_link$/, '');
        if (!byClass.has(cls) || z < STYLE[cls][2]) continue;
        byClass.get(cls).push(way);
      }
    }
    ctx.lineCap = ctx.lineJoin = 'round';
    const scale = ratio * Math.max(1, (z - 9) * 0.7);
    const seen = new Set();
    for (const cls of ORDER) {
      const [color, width] = STYLE[cls];
      ctx.strokeStyle = color; ctx.lineWidth = width * scale;
      ctx.beginPath();
      for (const way of byClass.get(cls)) {
        if (seen.has(way.id)) continue; // Wege über Kachelgrenzen kommen mehrfach
        seen.add(way.id);
        way.geometry.forEach((p, k) => {
          const [px, py] = toPx(p.lat, p.lon, z);
          const cx = (px - ox) * ratio, cy = (py - oy) * ratio;
          if (k) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy);
        });
      }
      ctx.stroke();
    }

    // Ortsnamen (Regionen + Paket-Kacheln, doppelte nur einmal)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const drawn = new Set();
    for (const [name, lat, lon, kind] of [...places, ...tilePlaces]) {
      if (drawn.has(name + lat.toFixed(3) + lon.toFixed(3))) continue;
      drawn.add(name + lat.toFixed(3) + lon.toFixed(3));
      if (z < (PLACE_ZOOM[kind] ?? 99) || lat < s || lat > n || lon < w || lon > e) continue;
      const [px, py] = toPx(lat, lon, z), cx = (px - ox) * ratio, cy = (py - oy) * ratio;
      ctx.font = `${kind === 'c' ? 600 : 500} ${(kind === 'c' ? 15 : kind === 't' ? 13 : 11) * ratio}px system-ui, sans-serif`;
      ctx.lineWidth = 3 * ratio; ctx.strokeStyle = '#0a0a0b'; ctx.strokeText(name, cx, cy);
      ctx.fillStyle = kind === 'v' ? '#a7acb4' : '#f4f4f2'; ctx.fillText(name, cx, cy);
    }
  }

  // Ortsnamen und Kacheln nach einem Region-Download neu laden
  layer.refresh = async () => { places = await allPlaces(); demCache[11].clear(); demCache[12].clear(); layer.redraw(); };
  layer.refresh();
  return layer;
}
