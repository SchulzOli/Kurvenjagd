// Kurvenreiches Motorrad-Routing auf OpenStreetMap-Daten.
// Ablauf: Straßen per Overpass laden -> Graph (Kreuzung zu Kreuzung) bauen ->
// Kurvigkeit je Kante aus Kurvenradien bestimmen -> Dijkstra mit Kurven-Bonus.

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const MAIN_ROADS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified';
export const LOCAL_ROADS = 'residential|living_street';
export const ACCESS = '["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"]["motorcycle"!~"^(no|private)$"]["area"!="yes"]';

import { FEATURES, featureRow } from './features.js';
import { edgeElevation } from './dem.js';
import { isOnline, markDown, isNetworkError } from './net.js';

// Alle Stellschrauben an einer Stelle. Absichtlich veränderbar: Das Parameter-Labor der Boxengasse
// probiert damit Varianten aus. DEFAULTS hält die Originalwerte.
export const P = {
  // Grundgeschwindigkeit in km/h (Zeitkosten und Fahrzeitschätzung)
  speed: { motorway: 120, trunk: 100, primary: 90, secondary: 80, tertiary: 70, unclassified: 60, residential: 30, living_street: 10 },
  // Straßenklassen-Faktor, wirkt umso stärker, je höher die Kurvenlust
  roadFactor: { motorway: 5, trunk: 3, primary: 1.5, secondary: 1, tertiary: 0.85, unclassified: 0.8, residential: 2, living_street: 4 },
  // Kurvenradius (m) -> Gewicht. Angelehnt an die Radius-Stufen von roadcurvature.com.
  bands: [[30, 1], [60, 0.8], [100, 0.6], [175, 0.35], [300, 0.12]],
  step: 20,         // Resampling-Abstand in m, glättet OSM-Knotenrauschen
  curveMin: 0.15,   // ab dieser Kurvigkeit zählt eine Kante als "kurvig"
  curveSat: 0.35,   // ab hier voller Kurven-Bonus (echte Kurvenstrecken liegen bei 0.3-0.45)
  bonus: 0.85,      // maximaler Rabatt auf kurvige Kanten bei voller Kurvenlust
  slowdown: 0.4,    // so viel langsamer fährt man bei Kurvigkeit 1
  reusePenalty: 6,  // Strafe für schon gefahrene Kanten (Etappen, Rundtour)
  loopShape: 7.9,   // Tourlänge / Kreisradius (Viereck auf Kreis * Umwegfaktor Straßennetz)
  // Gewichte der Merkmale aus features.js: Kosten × (1 + Gewicht × Wert). Positiv = meiden, negativ = bevorzugen.
  // Unbefestigte Wege meidet ein Straßenmotorrad deutlich; der Rest ist neutral und im Labor einstellbar.
  weights: { unpaved: 4, cobble: 0.5, rough: 1, slow: 0, narrow: 0, tunnel: 0, toll: 0, steep: 0, hilly: 0 },
};
export const DEFAULTS = JSON.parse(JSON.stringify(P));

// Messwerte der letzten Vorgänge (für die Boxengasse); kosten praktisch keine Rechenzeit
export const metrics = { load: null, build: null, route: null };
const search = { runs: 0, settled: 0, searchMs: 0, turnBlocks: 0, arcSearches: 0 };
const resetSearch = () => Object.assign(search, { runs: 0, settled: 0, searchMs: 0, turnBlocks: 0, arcSearches: 0 });
let curvTime = 0;

const baseClass = hw => hw.replace(/_link$/, '');

// ---------- Daten laden ----------

export const LOCAL_RADIUS = 1500; // m

// bbox = null lädt nur die Nebenstraßen um die focusPoints (zum Nachladen)
export async function fetchRoads(bbox, focusPoints = [], onProgress) {
  // Nebenstraßen nur rund um Start/Ziel laden, sonst wird die Antwort riesig
  const local = focusPoints
    .map(([lat, lon]) => `way["highway"~"^(${MAIN_ROADS}|${LOCAL_ROADS})$"]${ACCESS}(around:${LOCAL_RADIUS},${lat},${lon});`)
    .join('\n  ');
  const main = bbox ? `way["highway"~"^(${MAIN_ROADS})$"]${ACCESS}(${bbox.map(v => v.toFixed(5)).join(',')});` : '';
  const query = `[out:json][timeout:120][maxsize:536870912];
(
  ${main}
  ${local}
);
out geom qt;`;
  return overpass(query, onProgress);
}

// Overpass-Abfrage ausführen.
// record = false: nicht in metrics.load eintragen (z. B. Tankstellen-Suche)
export async function overpass(query, onProgress, { record = true } = {}) {
  // Öffentliche Overpass-Server sind oft überlastet (429/502/504) oder hängen:
  // alle parallel fragen, erste gültige Antwort nehmen, bei Totalausfall mit Pause wiederholen.
  let errors = [];
  const t0 = performance.now(), servers = [];
  if (!isOnline()) throw new Error('Kein Netz – Overpass nicht erreichbar');
  for (let round = 0; round < 4; round++) {
    let netFails = 0; // Fehler ohne Server-Antwort (kein Netz, DNS)
    onProgress?.(`Versuch ${round + 1} (${OVERPASS_URLS.length} Server parallel)`);
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const win = await Promise.any(OVERPASS_URLS.map(async url => {
        const host = new URL(url).host, ts = performance.now();
        const note = (ok, status) => servers.push({ host, round: round + 1, ok, status, ms: Math.round(performance.now() - ts) });
        try {
          const res = await fetch(url, {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: ctrl.signal,
          });
          if (!res.ok) { note(false, res.status); throw new Error(`${host}: ${res.status}`); }
          const text = await res.text(), tp = performance.now();
          const json = JSON.parse(text);
          note(true, res.status);
          return { json, host, bytes: text.length, parseMs: performance.now() - tp };
        } catch (err) {
          if (err.name === 'AbortError') { note(false, ctrl.signal.aborted && servers.some(x => x.ok) ? 'abgebrochen' : 'Timeout'); throw new Error(`${host}: Timeout`); }
          if (isNetworkError(err)) netFails++;
          if (!err.message.startsWith(host)) { note(false, 'Fehler'); throw new Error(`${host}: ${err.message}`); }
          throw err;
        }
      }));
      ctrl.abort(); // langsamere Server nicht weiter belasten
      if (record) metrics.load = { at: Date.now(), ms: performance.now() - t0, rounds: round + 1, winner: win.host, bytes: win.bytes,
        parseMs: win.parseMs, elements: win.json.elements.length, servers };
      return win.json;
    } catch (err) {
      errors = err.errors || [err];
      // Kein einziger Server erreichbar: das Netz ist weg – nicht minutenlang weiter versuchen
      if (netFails === OVERPASS_URLS.length) {
        markDown();
        if (record) metrics.load = { at: Date.now(), ms: performance.now() - t0, failed: true, servers };
        throw new Error('Kein Netz – Overpass nicht erreichbar');
      }
    } finally {
      clearTimeout(timer);
    }
    await new Promise(r => setTimeout(r, 3000 * 2 ** round));
  }
  if (record) metrics.load = { at: Date.now(), ms: performance.now() - t0, failed: true, servers };
  throw new Error('Overpass nicht erreichbar – ' + errors.map(e => e.message).join(', '));
}

export function bboxForPoints(points) {
  const lats = points.map(p => p[0]), lons = points.map(p => p[1]);
  const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
  if (n - s > 1.1 || e - w > 1.6) throw new Error('Zu weit für den Prototyp (max. ca. 110 km Luftlinie)');
  const pad = Math.max(0.25 * Math.max(n - s, e - w), 0.04);
  return [s - pad, w - pad, n + pad, e + pad];
}

export function bboxForLoop(start, targetKm) {
  const r = 2.4 * (targetKm * 1000) / P.loopShape + 2000;
  const dLat = r / 110540, dLon = r / (111320 * Math.cos(start[0] * Math.PI / 180));
  return [start[0] - dLat, start[1] - dLon, start[0] + dLat, start[1] + dLon];
}

export const bboxContains = (outer, inner) =>
  !!outer && outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

// ---------- Geometrie & Kurvigkeit ----------

export function haversine([lat1, lon1], [lat2, lon2]) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function polylineLength(geom) {
  let len = 0;
  for (let i = 1; i < geom.length; i++) len += haversine(geom[i - 1], geom[i]);
  return len;
}

function toLocal(geom) {
  const [lat0, lon0] = geom[0];
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return geom.map(([lat, lon]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
}

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0; // zurückgelegte Strecke seit dem letzten Sample
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    for (; d <= seg; d += step) out.push([x0 + (x1 - x0) * d / seg, y0 + (y1 - y0) * d / seg]);
    carry = seg - (d - step);
  }
  return out;
}

function circumRadius(a, b, c) {
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-9) return Infinity;
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1]) / (2 * cross);
}

function bendWeight(r) {
  for (const [max, w] of P.bands) if (r < max) return w;
  return 0;
}

// Anteil 0..1: wie viel der Strecke in Kurven liegt, gewichtet nach Enge
export function curviness(geom) {
  const p = resample(toLocal(geom), P.step);
  if (p.length < 3) return 0;
  let sum = 0;
  for (let i = 1; i < p.length - 1; i++) sum += bendWeight(circumRadius(p[i - 1], p[i], p[i + 1]));
  return sum / (p.length - 2);
}

// Meter je Radius-Stufe (Index wie P.bands, letzter Eintrag = gerade) – für Statistiken
export function bendMeters(geom) {
  const out = new Array(P.bands.length + 1).fill(0);
  const p = resample(toLocal(geom), P.step);
  for (let i = 1; i < p.length - 1; i++) {
    const r = circumRadius(p[i - 1], p[i], p[i + 1]), k = P.bands.findIndex(([max]) => r < max);
    out[k < 0 ? P.bands.length : k] += P.step;
  }
  return out;
}

// ---------- Graph ----------

function onewayDir(tags) {
  const o = tags.oneway;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === 'no') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular' || tags.highway === 'motorway') return 1;
  return 0;
}

// ---------- Zahlen-Spalten (Typed Arrays) ----------
// Alles, was die Kostenberechnung pro Kante braucht, liegt kompakt in Spalten statt in Objekten.
// Die Kanten-Objekte bleiben für Geometrie, Namen und Anzeige erhalten.

const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'other'];
const CLASS_INDEX = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
const OTHER = CLASSES.length - 1;
const K = FEATURES.length;

function makeCols(cap) {
  return { cap, len: new Float64Array(cap), curv: new Float64Array(cap), cls: new Uint8Array(cap), link: new Uint8Array(cap),
    dead: new Uint8Array(cap), known: new Uint16Array(cap), feat: new Float32Array(cap * K),
    way: new Float64Array(cap), up: new Float32Array(cap), down: new Float32Array(cap) };
}
// Beim Einrasten kommen Kanten hinzu: dann Spalten verdoppeln
function growCols(c, need) {
  if (need <= c.cap) return c;
  const n = makeCols(Math.max(need, c.cap * 2));
  for (const k of ['len', 'curv', 'cls', 'link', 'dead', 'known', 'feat', 'way', 'up', 'down']) n[k].set(c[k]);
  return n;
}

// Nachbarschaften als CSR: Kanten eines Knotens liegen hintereinander (start[v] … start[v+1]).
// Kanten, die nach dem Aufbau entstehen (Einrasten), kommen in eine kleine Zusatzliste g.extra.
function buildCsr(g) {
  const n = g.lat.length, arcs = g.arcs, m = arcs.length / 4;
  const start = new Int32Array(n + 1);
  for (let k = 0; k < m; k++) start[arcs[4 * k] + 1]++;
  for (let v = 0; v < n; v++) start[v + 1] += start[v];
  const pos = start.slice(0, n), edge = new Int32Array(m), to = new Int32Array(m), rev = new Uint8Array(m);
  for (let k = 0; k < m; k++) { // stabil: Reihenfolge je Knoten wie beim Einfügen
    const at = pos[arcs[4 * k]]++;
    to[at] = arcs[4 * k + 1]; edge[at] = arcs[4 * k + 2]; rev[at] = arcs[4 * k + 3];
  }
  g.csr = { n, start, edge, to, rev };
  // Bögen, die später entstehen (Einrasten), bekommen Nummern ab m; g.extra: Knoten -> Bogennummern
  g.extra = new Map(); g.xEdge = []; g.xTo = []; g.xRev = [];
  delete g.arcs;
}

// Ruft fn(kante, ziel, rückwärts) für alle ausgehenden Kanten von v auf
function forArcs(g, v, fn) {
  const c = g.csr;
  if (v < c.n) for (let k = c.start[v]; k < c.start[v + 1]; k++) fn(c.edge[k], c.to[k], c.rev[k]);
  const x = g.extra.get(v), m = c.edge.length;
  if (x) for (const a of x) fn(g.xEdge[a - m], g.xTo[a - m], g.xRev[a - m]);
}

// ---------- Abbiegeverbote ----------
// OSM-Relationen type=restriction: von Weg A über Knoten V nach Weg B ist verboten (no_*) bzw.
// ab A über V ist nur B erlaubt (only_*). Gespeichert über Weg-IDs, damit Kanten-Teilungen beim
// Einrasten nichts kaputt machen. Relationen mit einem Weg als „via“ werden (noch) übersprungen.
function buildTurns(rels, index) {
  const banned = new Set(), only = new Map(), via = new Set();
  let used = 0, skipped = 0;
  for (const r of rels) {
    const t = r.tags || {}, kind = t['restriction:motorcycle'] || t.restriction;
    if (!kind || /motorcycle/.test(t.except || '')) { skipped++; continue; }
    const ways = role => (r.members || []).filter(m => m.role === role && m.type === 'way').map(m => m.ref);
    const from = ways('from'), to = ways('to'), vias = (r.members || []).filter(m => m.role === 'via');
    const v = vias.length === 1 && vias[0].type === 'node' ? index.get(vias[0].ref) : undefined;
    if (v === undefined || !from.length || !to.length) { skipped++; continue; }
    via.add(v);
    for (const f of from) for (const w of to) {
      if (kind.startsWith('no_')) banned.add(`${f}|${v}|${w}`);
      else if (kind.startsWith('only_')) {
        const k = `${f}|${v}`;
        if (!only.has(k)) only.set(k, new Set());
        only.get(k).add(w);
      }
    }
    used++;
  }
  return { banned, only, via, used, skipped };
}

// Darf man an Knoten v von Kante fe auf Kante te abbiegen?
function turnAllowed(g, fe, v, te) {
  const t = g.turn, wf = g.col.way[fe], wt = g.col.way[te];
  if (t.banned.has(`${wf}|${v}|${wt}`)) return false;
  const only = t.only.get(`${wf}|${v}`);
  return !only || only.has(wt);
}

// dem (optional): Höhenmodell { z, tiles } aus dem.js – liefert Anstieg/Gefälle und die Merkmale steil/bergig
export function buildGraph(osm, dem = null) {
  const t0 = performance.now();
  curvTime = 0;
  const ways = osm.elements.filter(el =>
    el.type === 'way' && el.nodes?.length >= 2 && el.geometry?.length === el.nodes.length && el.geometry.every(Boolean));

  // Knoten wird Graph-Vertex, wenn er Wegende ist oder von mehreren Wegen geteilt wird
  const uses = new Map();
  for (const w of ways) w.nodes.forEach((id, i) => {
    const isEnd = i === 0 || i === w.nodes.length - 1;
    uses.set(id, (uses.get(id) || 0) + (isEnd ? 2 : 1));
  });

  const index = new Map(), lat = [], lon = [];
  const g = { lat, lon, edges: [], col: makeCols(Math.max(64, Math.round(ways.length * 1.3))), arcs: [], dem };
  const vertex = (id, p) => {
    let v = index.get(id);
    if (v === undefined) {
      v = lat.length;
      index.set(id, v); lat.push(p.lat); lon.push(p.lon);
    }
    return v;
  };

  for (const w of ways) {
    const t = w.tags || {}, dir = onewayDir(t), frow = featureRow(t); // Merkmale einmal je Weg
    const name = t.ref ? (t.name ? `${t.name} (${t.ref})` : t.ref) : (t.name || '');
    let s = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && uses.get(w.nodes[i]) < 2) continue;
      const geom = w.geometry.slice(s, i + 1).map(p => [p.lat, p.lon]);
      const a = vertex(w.nodes[s], w.geometry[s]), b = vertex(w.nodes[i], w.geometry[i]);
      addEdge(g, a, b, geom, t.highway, name, dir, frow, w.id);
      s = i;
    }
  }

  buildCsr(g);
  g.turn = buildTurns(osm.elements.filter(el => el.type === 'relation' && el.tags?.type === 'restriction'), index);
  g.main = largestComponent(g);
  metrics.build = { at: Date.now(), ms: performance.now() - t0, curvMs: curvTime, ways: ways.length, nodes: lat.length, edges: g.edges.length,
    mainShare: g.main.reduce((a, b) => a + b, 0) / (lat.length || 1), turns: { used: g.turn.used, skipped: g.turn.skipped }, dem: !!dem };
  return g;
}

// Markiert die größte zusammenhängende Komponente, damit Start/Ziel nicht auf Inseln landen
function largestComponent(g) {
  const n = g.lat.length, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = x => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (const e of g.edges) parent[find(e.a)] = find(e.b);
  const size = new Int32Array(n);
  let best = 0;
  for (let i = 0; i < n; i++) { const r = find(i); if (++size[r] > size[best]) best = r; }
  const main = new Array(n); // normales Array: snapToRoad hängt Knoten an
  for (let i = 0; i < n; i++) main[i] = find(i) === best ? 1 : 0;
  return main;
}

// frow: Merkmale des Weges ({ values, known } aus featureRow), wayId: OSM-Weg (für Abbiegeverbote)
const STEEP = FEATURES.findIndex(f => f.key === 'steep'), HILLY = FEATURES.findIndex(f => f.key === 'hilly');
function addEdge(g, a, b, geom, hw, name, dir, frow, wayId) {
  const tc = performance.now();
  const e = { id: g.edges.length, a, b, geom, hw, name, dir, len: polylineLength(geom), curv: curviness(geom) };
  curvTime += performance.now() - tc;
  g.edges.push(e);
  const c = g.col = growCols(g.col, e.id + 1);
  c.len[e.id] = e.len; c.curv[e.id] = e.curv;
  c.cls[e.id] = CLASS_INDEX[baseClass(hw)] ?? OTHER; c.link[e.id] = hw.endsWith('_link') ? 1 : 0;
  c.feat.set(frow.values, e.id * K); c.known[e.id] = frow.known; c.way[e.id] = wayId;
  // Höhenmodell: Anstieg/Gefälle in Zeichenrichtung, Merkmale steil (Anteil über 8 % Steigung) und bergig (60 Hm/km → 1)
  const el = g.dem && edgeElevation(g.dem, geom, e.len);
  if (el) {
    c.up[e.id] = el.up; c.down[e.id] = el.down;
    c.feat[e.id * K + STEEP] = el.steepShare;
    c.feat[e.id * K + HILLY] = Math.min(1, (el.up + el.down) / 2 / (e.len || 1) * 1000 / 60);
    c.known[e.id] |= (1 << STEEP) | (1 << HILLY);
  }
  if (g.grid) gridAdd(g.grid, e);
  // Während des Aufbaus Bögen sammeln (danach CSR), später direkt in die Zusatzliste
  const arc = (from, to, rev) => {
    if (!g.csr) { g.arcs.push(from, to, e.id, rev); return; }
    const id = g.csr.edge.length + g.xEdge.length, x = g.extra.get(from);
    g.xEdge.push(e.id); g.xTo.push(to); g.xRev.push(rev);
    if (x) x.push(id); else g.extra.set(from, [id]);
  };
  if (dir >= 0) arc(a, b, 0);
  if (dir <= 0) arc(b, a, 1);
  return e;
}

const blocked = (e, opt) => e.dead || (opt.avoidHighway && /^(motorway|trunk)$/.test(baseClass(e.hw)));

// Rastet einen Punkt auf die nächste befahrbare Straße ein, nicht nur auf Kreuzungen:
// die getroffene Kante wird am Lotfußpunkt in zwei Kanten geteilt.
// ---------- Räumliches Raster fürs Einrasten ----------
// Statt alle Kanten zu prüfen, liegen sie in Zellen von 0,005° (~550 × 370 m). Gesucht wird ringförmig
// um den Punkt, bis kein näherer Treffer mehr möglich ist.
const CELL = 0.005;
const cellKey = (i, j) => i * 1e6 + j;

function gridAdd(grid, e) {
  let s = Infinity, w = Infinity, n = -Infinity, ea = -Infinity;
  for (const [la, lo] of e.geom) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > ea) ea = lo; }
  for (let i = Math.floor(s / CELL); i <= Math.floor(n / CELL); i++)
    for (let j = Math.floor(w / CELL); j <= Math.floor(ea / CELL); j++) {
      const k = cellKey(i, j), cell = grid.get(k);
      if (cell) cell.push(e.id); else grid.set(k, [e.id]);
    }
}

function ensureGrid(g) {
  if (!g.grid) { g.grid = new Map(); for (const e of g.edges) gridAdd(g.grid, e); }
  return g.grid;
}

// Nächster Punkt auf einer Kante; d in „Grad mit Längen-Korrektur“, wie beim Vergleich üblich
function nearestOnEdge(e, lat, lon, kx, best) {
  for (let i = 0; i < e.geom.length - 1; i++) {
    const x1 = (e.geom[i][1] - lon) * kx, y1 = e.geom[i][0] - lat;
    const dx = (e.geom[i + 1][1] - lon) * kx - x1, dy = e.geom[i + 1][0] - lat - y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / l2)) : 0;
    const d = (x1 + t * dx) ** 2 + (y1 + t * dy) ** 2;
    if (!best || d < best.d) best = { e, i, t, d };
  }
  return best;
}

export function snapToRoad(g, [lat, lon], opt) {
  const kx = Math.cos(lat * Math.PI / 180);
  const grid = ensureGrid(g), seen = new Set();
  const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL);
  let best = null;
  for (let r = 0; r <= 400; r++) {
    for (let i = ci - r; i <= ci + r; i++)
      for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // nur der Ring r
        for (const id of grid.get(cellKey(i, j)) || []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = g.edges[id];
          if (blocked(e, opt) || !g.main[e.a]) continue;
          best = nearestOnEdge(e, lat, lon, kx, best);
        }
      }
    // Alles außerhalb von Ring r ist mindestens r Zellen entfernt: Abbruch, wenn der Treffer näher liegt
    if (best && Math.sqrt(best.d) <= r * CELL * kx) break;
  }
  if (!best) throw new Error('Keine befahrbare Straße in der Nähe');

  const { e, i, t } = best, [p, q] = [e.geom[i], e.geom[i + 1]];
  const P = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  // Liegt der Punkt fast auf einem Kantenende, dieses nehmen (vermeidet Mini-Kanten)
  for (const v of [e.a, e.b]) if (haversine(P, [g.lat[v], g.lon[v]]) < 15) return v;

  const v = g.lat.length;
  g.lat.push(P[0]); g.lon.push(P[1]); g.main.push(1);
  e.dead = true;
  g.col.dead[e.id] = 1; // bleibt in der CSR-Liste, kostet aber ∞ und wird so nie benutzt
  const frow = { values: g.col.feat.slice(e.id * K, e.id * K + K), known: g.col.known[e.id] };
  const wayId = g.col.way[e.id];
  addEdge(g, e.a, v, [...e.geom.slice(0, i + 1), P], e.hw, e.name, e.dir, frow, wayId);
  addEdge(g, v, e.b, [P, ...e.geom.slice(i + 1)], e.hw, e.name, e.dir, frow, wayId);
  return v;
}

export function nearestVertex(g, [lat, lon], costs) {
  const kx = Math.cos(lat * Math.PI / 180);
  let best = -1, bestD = Infinity;
  for (let v = 0; v < g.lat.length; v++) {
    if (!g.main[v]) continue;
    const d = (g.lat[v] - lat) ** 2 + ((g.lon[v] - lon) * kx) ** 2;
    if (d >= bestD) continue;
    let exit = false;
    forArcs(g, v, e => { if (costs[e] < Infinity) exit = true; });
    if (exit) { bestD = d; best = v; }
  }
  if (best < 0) throw new Error('Keine befahrbare Straße in der Nähe');
  return best;
}

// ---------- Kosten ----------

export function edgeTime(e) {
  let v = P.speed[baseClass(e.hw)] ?? 50;
  if (e.hw.endsWith('_link')) v *= 0.6;
  v *= 1 - P.slowdown * e.curv; // in Kurven fährt man langsamer
  return e.len / (v / 3.6);
}

// curvy = 0: schnellste Route; curvy = 1: maximal kurvig.
// Kosten = Fahrzeit × Straßenklassen-Faktor × Kurvenbonus × Π (1 + Gewicht × Merkmal).
// Läuft über die Zahlen-Spalten; Merkmale mit Gewicht 0 kosten keine Rechenzeit.
export function costArray(g, opt) {
  const { curvy } = opt, c = g.col, n = g.edges.length;
  // Werte je Straßenklasse einmal vorab statt je Kante nachschlagen
  const speed = CLASSES.map(k => P.speed[k] ?? 50);
  const roadF = CLASSES.map(k => 1 + ((P.roadFactor[k] ?? 1.5) - 1) * curvy);
  const off = CLASSES.map(k => opt.avoidHighway && (k === 'motorway' || k === 'trunk'));
  const active = FEATURES.map((f, i) => [i, P.weights?.[f.key] || 0]).filter(([, w]) => w);
  const bonusK = P.bonus * curvy, sat = P.curveSat, slow = P.slowdown;
  const out = new Float64Array(n);
  for (let e = 0; e < n; e++) {
    const k = c.cls[e];
    if (c.dead[e] || off[k]) { out[e] = Infinity; continue; }
    const cv = c.curv[e];
    const v = speed[k] * (c.link[e] ? 0.6 : 1) * (1 - slow * cv);
    let cost = c.len[e] / (v / 3.6) * roadF[k] * (1 - bonusK * Math.min(1, cv / sat));
    for (const [i, w] of active) {
      const f = c.feat[e * K + i];
      if (f) cost *= Math.max(0.05, 1 + w * f);
    }
    out[e] = cost;
  }
  return out;
}

// Merkmale einer Kante als Objekt (nur Werte ≠ 0), z. B. { unpaved: 1 }
export function edgeFeatures(g, id) {
  const out = {};
  FEATURES.forEach((f, i) => { const v = g.col.feat[id * K + i]; if (v) out[f.key] = +v.toFixed(2); });
  return out;
}

// ---------- Suche ----------

class MinHeap {
  k = []; v = [];
  get size() { return this.k.length; }
  push(key, val) {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    this.topKey = k[0];
    const topV = v[0], lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return topV;
  }
}

// Wegsuche in zwei Stufen:
// 1. schnelle Suche über Knoten (ignoriert Abbiegeverbote),
// 2. verstößt der gefundene Weg gegen ein Verbot, Suche über gerichtete Kanten („Bögen“), die Verbote beachtet.
// Das ist immer korrekt: Ist der schnellste Weg überhaupt erlaubt, ist er auch der schnellste erlaubte.
// Stufe 2 wird nur selten gebraucht, ist aber 2–5× teurer (mehr Zustände).
export function dijkstra(g, src, dst, costs, used) {
  if (src === dst) { search.runs++; return []; }
  const steps = dijkstraNodes(g, src, dst, costs, used);
  if (!steps || !g.turn?.via.size || turnsOk(g, steps)) return steps;
  search.arcSearches++;
  return dijkstraArcs(g, src, dst, costs, used);
}

// Verletzt der Weg ein Abbiegeverbot?
function turnsOk(g, steps) {
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i], ea = g.edges[a.e];
    const v = a.rev ? ea.a : ea.b; // Knoten zwischen den beiden Kanten
    if (g.turn.via.has(v) && !turnAllowed(g, a.e, v, b.e)) return false;
  }
  return true;
}

function dijkstraNodes(g, src, dst, costs, used) {
  const t0 = performance.now();
  let settled = 0;
  const n = g.lat.length, csr = g.csr, m = csr.edge.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevV = new Int32Array(n).fill(-1), prevE = new Int32Array(n), prevRev = new Uint8Array(n);
  const heap = new MinHeap(), hasExtra = g.extra.size > 0, pen = P.reusePenalty;
  dist[src] = 0;
  heap.push(0, src);
  while (heap.size) {
    const v = heap.pop(), d = heap.topKey;
    if (d > dist[v]) continue;
    settled++;
    if (v === dst) break;
    // Schleifen ausgeschrieben statt Hilfsfunktion: keine Objekte pro Schritt, deutlich schneller
    if (v < csr.n) {
      for (let k = csr.start[v], end = csr.start[v + 1]; k < end; k++) {
        const e = csr.edge[k], to = csr.to[k];
        const nd = d + costs[e] * (used && used.has(e) ? pen : 1);
        if (nd < dist[to]) { dist[to] = nd; prevV[to] = v; prevE[to] = e; prevRev[to] = csr.rev[k]; heap.push(nd, to); }
      }
    }
    const x = hasExtra ? g.extra.get(v) : undefined;
    if (x) {
      for (const a of x) {
        const e = g.xEdge[a - m], to = g.xTo[a - m];
        const nd = d + costs[e] * (used && used.has(e) ? pen : 1);
        if (nd < dist[to]) { dist[to] = nd; prevV[to] = v; prevE[to] = e; prevRev[to] = g.xRev[a - m]; heap.push(nd, to); }
      }
    }
  }
  search.runs++; search.settled += settled; search.searchMs += performance.now() - t0;
  if (dist[dst] === Infinity) return null;
  const steps = [];
  for (let v = dst; v !== src; v = prevV[v]) steps.push({ e: prevE[v], rev: !!prevRev[v] });
  return steps.reverse();
}

// Suche über gerichtete Kanten: prüft bei jedem Übergang, ob das Abbiegen erlaubt ist.
// Wenden auf derselben Kante nur in Sackgassen.
function dijkstraArcs(g, src, dst, costs, used) {
  const t0 = performance.now();
  let settled = 0, blocked = 0, goal = -1;
  const csr = g.csr, m = csr.edge.length, A = m + g.xEdge.length;
  const xE = g.xEdge, xT = g.xTo, xR = g.xRev, ext = g.extra, hasExtra = ext.size > 0, pen = P.reusePenalty;
  const turns = g.turn && g.turn.via.size > 0 ? g.turn : null;
  const dist = new Float64Array(A).fill(Infinity), prev = new Int32Array(A).fill(-1);
  const heap = new MinHeap();
  const cost = e => costs[e] * (used && used.has(e) ? pen : 1);
  // befahrbare Ausfahrten eines Knotens (für die Sackgassen-Regel beim Wenden)
  const exits = v => { let n = 0; forArcs(g, v, e => { if (costs[e] < Infinity) n++; }); return n; };

  // Start: alle Bögen, die vom Startknoten wegführen
  if (src < csr.n) for (let k = csr.start[src]; k < csr.start[src + 1]; k++) {
    const d = cost(csr.edge[k]);
    if (d < dist[k]) { dist[k] = d; heap.push(d, k); }
  }
  for (const k of (hasExtra && ext.get(src)) || []) {
    const d = cost(xE[k - m]);
    if (d < dist[k]) { dist[k] = d; heap.push(d, k); }
  }

  while (heap.size) {
    const a = heap.pop(), d = heap.topKey;
    if (d > dist[a]) continue;
    settled++;
    const v = a < m ? csr.to[a] : xT[a - m];
    if (v === dst) { goal = a; break; }
    const ea = a < m ? csr.edge[a] : xE[a - m];
    const check = turns !== null && turns.via.has(v);
    let ex = -1; // Ausfahrten, nur bei Bedarf gezählt
    if (v < csr.n) {
      for (let k = csr.start[v], end = csr.start[v + 1]; k < end; k++) {
        const e = csr.edge[k];
        if (e === ea && (ex < 0 ? (ex = exits(v)) : ex) > 1) continue;
        if (check && !turnAllowed(g, ea, v, e)) { blocked++; continue; }
        const nd = d + cost(e);
        if (nd < dist[k]) { dist[k] = nd; prev[k] = a; heap.push(nd, k); }
      }
    }
    const x = hasExtra ? ext.get(v) : undefined;
    if (x) {
      for (const k of x) {
        const e = xE[k - m];
        if (e === ea && (ex < 0 ? (ex = exits(v)) : ex) > 1) continue;
        if (check && !turnAllowed(g, ea, v, e)) { blocked++; continue; }
        const nd = d + cost(e);
        if (nd < dist[k]) { dist[k] = nd; prev[k] = a; heap.push(nd, k); }
      }
    }
  }
  search.runs++; search.settled += settled; search.searchMs += performance.now() - t0; search.turnBlocks += blocked;
  if (goal < 0) return null;
  const steps = [];
  for (let a = goal; a !== -1; a = prev[a]) steps.push({ e: a < m ? csr.edge[a] : xE[a - m], rev: !!(a < m ? csr.rev[a] : xR[a - m]) });
  return steps.reverse();
}

export function summarize(g, steps) {
  let len = 0, time = 0, curvyLen = 0, curvSum = 0, reuse = 0, up = 0, down = 0;
  const coords = [], seen = new Set();
  const stepAt = []; // Index in coords, an dem jede Kante beginnt (= Kreuzung davor)
  for (const { e, rev } of steps) {
    const ed = g.edges[e], geom = rev ? [...ed.geom].reverse() : ed.geom;
    stepAt.push(Math.max(0, coords.length - 1));
    coords.push(...(coords.length ? geom.slice(1) : geom));
    len += ed.len; time += edgeTime(ed); curvSum += ed.curv * ed.len;
    if (ed.curv >= P.curveMin) curvyLen += ed.len;
    if (seen.has(e)) reuse += ed.len;
    seen.add(e);
    // Anstieg/Gefälle in Fahrtrichtung
    up += rev ? g.col.down[e] : g.col.up[e];
    down += rev ? g.col.up[e] : g.col.down[e];
  }
  const res = { steps, coords, stepAt, len, time, curvyLen, reuse, avgCurv: len ? curvSum / len : 0,
    up: g.dem ? up : null, down: g.dem ? down : null };
  // Statistik je Etappe (Start -> Stopp 1 -> ... -> Ziel)
  if (steps.legEnds) {
    let from = 0;
    res.legs = steps.legEnds.map(to => {
      const { len, time, curvyLen, avgCurv, up, down } = summarize(g, steps.slice(from, (from = to)));
      return { len, time, curvyLen, avgCurv, up, down };
    });
  }
  return res;
}

// ---------- Routing-Modi ----------

// Verbindet die Knoten der Reihe nach (Etappen). Mit `used` werden schon gefahrene Kanten
// in späteren Etappen bestraft, damit die Route nicht dieselbe Straße zurückfährt.
function routeLegs(g, verts, costs, used) {
  const steps = [];
  steps.legEnds = []; // Index in steps, an dem jede Etappe endet
  for (let i = 0; i < verts.length - 1; i++) {
    const leg = dijkstra(g, verts[i], verts[i + 1], costs, used);
    if (!leg) return null;
    if (used) for (const s of leg) used.add(s.e);
    steps.push(...leg);
    steps.legEnds.push(steps.length);
  }
  return steps;
}

// A -> Zwischenstopps -> B. Ist der Umweg zur schnellsten Route (durch dieselben Stopps)
// zu groß, wird die Kurvenlust schrittweise reduziert.
export function routeVia(g, points, opt) {
  const t0 = performance.now();
  resetSearch();
  const verts = points.map(p => snapToRoad(g, p, opt));
  const snapMs = performance.now() - t0, trail = [];
  const baseSteps = routeLegs(g, verts, costArray(g, { ...opt, curvy: 0 }));
  if (!baseSteps) throw new Error('Keine Verbindung zwischen allen Punkten gefunden');
  const base = summarize(g, baseSteps);
  const limit = base.len * opt.maxDetour;
  const attempt = curvy => {
    trail.push(+curvy.toFixed(2));
    return { ...summarize(g, routeLegs(g, verts, costArray(g, { ...opt, curvy }), new Set())), curvyUsed: curvy };
  };
  // Erst die gewünschte Kurvenlust; ist der Umweg zu groß, per Binärsuche die größte passende finden
  // (4 Schritte = Genauigkeit 1/16 der Kurvenlust statt bis zu 9 Läufen in 0,1-Schritten)
  let route = attempt(opt.curvy);
  if (route.len > limit) {
    let lo = 0, hi = opt.curvy, ok = null;
    for (let k = 0; k < 4; k++) {
      const mid = (lo + hi) / 2, r = attempt(mid);
      if (r.len <= limit) { lo = mid; ok = r; } else hi = mid;
    }
    route = ok || attempt(0);
  }
  metrics.route = { at: Date.now(), mode: 'ab', ms: performance.now() - t0, snapMs, legs: verts.length - 1, trail, ...search };
  return { route, base, snapped: verts, waypoints: [] };
}

// Alternative zur gefundenen Route: dieselben (eingerasteten) Punkte, aber die Kanten der Hauptroute
// kosten das `factor`-Fache. So entsteht eine eigenständige zweite Variante, die nur dort mit der
// Hauptroute zusammenläuft, wo es keine sinnvolle andere Straße gibt.
export function alternativeRoute(g, verts, opt, mainSteps, factor = 1.8) {
  const costs = costArray(g, opt);
  for (const { e } of mainSteps) costs[e] *= factor;
  const steps = routeLegs(g, verts, costs, new Set());
  return steps && { ...summarize(g, steps), curvyUsed: opt.curvy };
}

// Anteil (nach Länge) der Route b, der auf Kanten der Route a liegt
export function overlap(g, a, b) {
  const inA = new Set(a.map(s => s.e));
  let same = 0, total = 0;
  for (const { e } of b) { total += g.edges[e].len; if (inA.has(e)) same += g.edges[e].len; }
  return total ? same / total : 1;
}

function offset([lat, lon], dist, bearing) {
  return [
    lat + dist * Math.cos(bearing) / 110540,
    lon + dist * Math.sin(bearing) / (111320 * Math.cos(lat * Math.PI / 180)),
  ];
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rundtour: 3 Wegpunkte auf einem Kreis durch den Start, Etappen kurvig verbinden,
// schon gefahrene Kanten bestrafen. Mehrere Ausrichtungen testen, beste nach Score nehmen.
function loopCandidate(g, src, start, radius, theta, costs) {
  const center = offset(start, radius, theta);
  const wps = [1, 2, 3].map(j => nearestVertex(g, offset(center, radius, theta + Math.PI + j * Math.PI / 2), costs));
  const steps = routeLegs(g, [src, ...wps, src], costs, new Set());
  return steps && { ...summarize(g, steps), waypoints: wps };
}

export function roundTrip(g, start, opt) {
  const t0 = performance.now();
  resetSearch();
  let candidates = 0, passes = 0;
  const target = opt.targetKm * 1000, tries = opt.tries ?? 4;
  const src = snapToRoad(g, start, opt);
  const costs = costArray(g, opt);
  const theta0 = mulberry32(opt.seed)() * 2 * Math.PI;
  let radius = target / P.loopShape, best = null;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < tries; k++) {
      const cand = loopCandidate(g, src, start, radius, theta0 + k * 2 * Math.PI / tries, costs);
      candidates++;
      if (!cand || !cand.len) continue;
      cand.score = cand.avgCurv - 0.6 * Math.abs(cand.len - target) / target - 0.5 * cand.reuse / cand.len;
      if (!best || cand.score > best.score) best = cand;
    }
    passes++;
    if (!best) throw new Error('Keine Rundtour gefunden');
    const ratio = target / best.len;
    if (Math.abs(1 - ratio) < 0.15) break;
    radius *= Math.min(1.4, Math.max(0.6, ratio)); // Radius nachjustieren und nochmal
  }
  metrics.route = { at: Date.now(), mode: 'loop', ms: performance.now() - t0, candidates, passes, ...search };
  return { route: { ...best, curvyUsed: opt.curvy }, base: null, snapped: [src], waypoints: best.waypoints };
}

// wpts: [{ lat, lon, name }] – Start, Zwischenstopps, Ziel als Wegpunkte für Navi-Apps
export function toGPX(coords, name, wpts = []) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const pts = coords.map(([lat, lon]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n');
  const wp = wpts.map(w => `<wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><name>${esc(w.name)}</name></wpt>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Kurvenjaeger" xmlns="http://www.topografix.com/GPX/1/1">
${wp}<trk><name>${esc(name)}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>`;
}
