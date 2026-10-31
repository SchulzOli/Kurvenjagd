import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as R from './router.js';
import { initRide } from './ride.js';
import { listRoutes, saveRoute, loadRoute, deleteRoute, packWays, unpackWays, packRels, unpackRels } from './store.js';
import { log, timed, counters } from './telemetry.js';
import { initBoxengasse } from './boxengasse.js';
import { engine } from './engine-client.js';
import { loadArea, isOnline } from './tiles.js';
import { PRESETS, listRegions, downloadRegion, deleteRegion, estimate, checkBbox } from './regions.js';
import { offlineLayer, reliefLayer } from './offlinemap.js';
import { keepAwake } from './speech.js';
import { Network } from '@capacitor/network';
import { routeConditions } from './weather.js';
import { buildTrack, pointAt } from './nav.js';
import { net, markDown, markUp } from './net.js';
import { FEATURES } from './features.js';
import { int16ToBase64, base64ToInt16 } from './dem.js';
import { initProfile } from './profile-ui.js';
import { initSupport } from './support.js';
import { initAbout } from './about.js';
import { CONFIG } from './config.js';
import { leafletLayer, paintRules, labelRules } from 'protomaps-leaflet';
import { namedFlavor } from '@protomaps/basemaps';
import { PMTiles } from 'pmtiles';

const $ = id => document.getElementById(id);
const native = Capacitor.isNativePlatform();
const phone = matchMedia('(max-width: 759px)');

const map = L.map('map', { preferCanvas: true, zoomControl: false }).setView([48.05, 8.2], 10); // Schwarzwald
if (!phone.matches) L.control.zoom({ position: 'bottomright' }).addTo(map);
// Eigene Vektorkarte: eine PMTiles-Datei vom eigenen Speicher (scripts/build-map.mjs), gezeichnet von
// protomaps-leaflet. Keine fremden Kachelserver; „Dunkle Karte“ ist eine eigene Farbvariante.
const MAP_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a> · <a href="https://protomaps.com">Protomaps</a>';
const mapFile = new PMTiles(CONFIG.mapUrl);
let base = null, maxDataZoom = 15;
// Dunkle Karte im Cockpit-Stil: Straßen, Wasser und Wald deutlicher als im Protomaps-Standard,
// damit sie nachts wie in der Sonne erkennbar bleiben
function flavor(dark) {
  if (!dark) return namedFlavor('light');
  const road = { other: '#46464b', minor_service: '#46464b', minor_a: '#59595f', minor_b: '#505056', link: '#6e6e75', major: '#6e6e75', highway: '#909097' };
  return { ...namedFlavor('dark'), ...road, background: '#0a0a0b', earth: '#131315', park_a: '#171c18', park_b: '#182019', wood_a: '#181d19', wood_b: '#181d19', water: '#17202d',
    bridges_other: road.other, bridges_minor: road.minor_a, bridges_link: road.link, bridges_major: road.major, bridges_highway: road.highway,
    roads_label_minor: '#8a8d93', roads_label_major: '#a3a6ac', city_label: '#c9ccd1' };
}
function makeBase() {
  const first = !base, wasOn = base && map.hasLayer(base);
  if (base) map.removeLayer(base);
  const f = flavor(document.getElementById('dark').checked);
  base = leafletLayer({ url: mapFile, paintRules: paintRules(f), labelRules: labelRules(f, 'de'), backgroundColor: f.background,
    maxDataZoom, maxZoom: 19, attribution: MAP_ATTR });
  for (const ev of ['tileload', 'tileerror']) base.on(ev, () => { counters[ev === 'tileload' ? 'tilesOk' : 'tilesErr']++; });
  if (first || wasOn) base.addTo(map);
}
makeBase();
// Datei-Kopf verrät, bis zu welchem Zoom Daten drin sind (darüber wird hochskaliert)
mapFile.getHeader().then(h => { if (h.maxZoom !== maxDataZoom) { maxDataZoom = h.maxZoom; makeBase(); applyMapSource(); } })
  .catch(err => log('karte', `Kartendatei nicht lesbar: ${err.message}`));

const S = {
  mode: 'ab', start: null, end: null, pointMarkers: [], dragging: false, graph: null, bbox: null, result: null,
  vias: [], // Zwischenstopps (nur Start → Ziel), in Fahrreihenfolge
  names: new Map(),         // Ortsnamen der Punkte (Reverse-Geocoding)
  ways: new Map(), focus: [], // geladene OSM-Wege und Punkte, um die Nebenstraßen geladen sind
  rels: new Map(), dem: null, // Abbiegeverbote (OSM-Relationen) und Höhenmodell des geladenen Gebiets
  seed: 1, busy: false, phase: '', error: null,
  resultKey: null, // Eingaben, mit denen die angezeigte Route berechnet wurde
  paramVer: 0,     // erhöht sich bei Änderungen im Parameter-Labor
  routeLayer: L.layerGroup().addTo(map), heatLayer: L.layerGroup(), condLayer: L.layerGroup(), traceLayer: L.layerGroup().addTo(map),
  depart: null, cond: null, // Abfahrtszeit (null = jetzt) und Bedingungen unterwegs (Wetter, Sonne)
};

// Blau (gerade) -> Grün -> Gelb -> Orange -> Rot (sehr kurvig)
const STOPS = [[0, [79, 123, 217]], [0.08, [46, 194, 126]], [0.16, [245, 194, 17]], [0.25, [255, 122, 26]], [0.35, [224, 27, 36]]];
function color(c) {
  for (let i = 1; i < STOPS.length; i++) {
    const [x1, c1] = STOPS[i], [x0, c0] = STOPS[i - 1];
    if (c <= x1) {
      const t = (c - x0) / (x1 - x0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')})`;
    }
  }
  return 'rgb(224,27,36)';
}

const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const km = m => (m / 1000).toFixed(1) + ' km';
const hm = s => `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, '0')} h`;
const pct = x => Math.round(x * 100) + ' %';
const tick = () => new Promise(r => setTimeout(r, 20));

function status(msg, err = false) { $('status').textContent = msg; $('status').className = 'row' + (err ? ' err' : ''); }

// Fortschritt während der Berechnung: Detailzeile + Aktionsleiste
function progress(msg) { S.phase = msg; status(msg); updateUI(); }

function options() {
  return {
    curvy: $('curvy').value / 100,
    maxDetour: $('detour').value / 100,
    targetKm: +$('len').value,
    avoidHighway: $('avoid').checked,
    seed: S.seed,
  };
}

function updateLabels() {
  $('curvyVal').textContent = $('curvy').value + ' %';
  $('detourVal').textContent = '× ' + ($('detour').value / 100).toFixed(1);
  $('lenVal').textContent = $('len').value + ' km';
}

// ---------- Zustand: wann kann/soll berechnet werden? ----------

// Alles, was das Ergebnis beeinflusst. Weicht es vom Stand der angezeigten Route ab, ist sie veraltet.
function inputKey() {
  const o = options();
  return JSON.stringify([S.mode, routePoints(), S.paramVer, o.curvy, o.avoidHighway,
    S.mode === 'ab' ? o.maxDetour : o.targetKm, S.mode === 'loop' ? S.seed : 0]);
}

const ready = () => !!S.start && (S.mode === 'loop' || !!S.end);
// Punkte in Fahrreihenfolge: Start, Zwischenstopps, Ziel (Rundtour: nur Start)
const routePoints = () => S.mode === 'ab' ? [S.start, ...S.vias, S.end] : [S.start];

function updateUI() {
  const stale = !!S.result && S.resultKey !== inputKey();
  const fresh = !!S.result && !stale;
  // [Text, erledigt, optional]
  const steps = S.mode === 'ab'
    ? [['Start setzen', !!S.start], ['Ziel setzen', !!S.end],
       [S.vias.length ? `${S.vias.length} Zwischenstopp${S.vias.length > 1 ? 's' : ''}` : 'Zwischenstopps (optional)', S.vias.length > 0, true],
       ['Berechnen', fresh]]
    : [['Start setzen', !!S.start], ['Berechnen', fresh]];
  const now = steps.findIndex(([, done, opt]) => !done && !opt);
  $('steps').innerHTML = steps.map(([label, done, opt], i) =>
    `<li class="${done ? 'done' : i === now ? 'now' : opt ? 'opt' : ''}">${opt ? '+' : i + 1 - steps.slice(0, i).filter(s => s[2]).length + '.'} ${label}</li>`).join('');
  renderStops();

  let hint, cls = '';
  if (S.busy) hint = S.phase || 'Berechne …';
  else if (!S.start) hint = 'Tippe auf die Karte, um den Start zu setzen.';
  else if (S.mode === 'ab' && !S.end) hint = 'Tippe auf die Karte, um das Ziel zu setzen.';
  else if (S.error) { hint = 'Berechnung fehlgeschlagen. Tippe erneut auf „Berechnen“.'; cls = 'err'; }
  else if (!S.result) {
    hint = S.mode === 'ab'
      ? 'Bereit. Weitere Taps auf die Karte fügen Zwischenstopps hinzu. Gerechnet wird erst bei „Berechnen“.'
      : 'Bereit. Gerechnet wird erst, wenn du auf „Berechnen“ tippst.';
    cls = 'ok';
  }
  else if (stale) { hint = 'Eingaben geändert: Die angezeigte Route ist veraltet.'; cls = 'warn'; }
  else { hint = '✓ Route ist aktuell. Tippe auf „Fahrt starten“.'; cls = 'ok'; }
  $('readyHint').textContent = hint;
  $('readyHint').className = cls;

  const go = $('go');
  go.disabled = S.busy || !ready();
  go.textContent = S.busy ? 'Berechne …' : stale ? 'Neu berechnen' : 'Berechnen';
  go.classList.toggle('busy', S.busy);
  go.classList.toggle('attention', !go.disabled && (!S.result || stale));
  go.classList.add('primary');
  // aktuelle Route: „Fahrt starten“ statt „Berechnen“
  go.hidden = fresh && !S.busy;
  $('ride').hidden = $('save').hidden = !go.hidden;
  go.title = S.busy ? 'Berechnung läuft' : !ready() ? (S.mode === 'ab' ? 'Erst Start und Ziel auf der Karte setzen' : 'Erst Start setzen') : '';
  $('reroll').disabled = S.busy || !ready();
  $('gpx').disabled = S.busy || !S.result || stale;

  // veraltete Route blass zeigen
  S.routeLayer.eachLayer(l => l.setStyle?.({ opacity: stale ? 0.3 : l.baseOpacity }));
  $('stats').classList.toggle('stale', stale);
  $('summary').classList.toggle('stale', stale);
}

// ---------- Bottom-Sheet ----------

function setSheet(open) {
  $('sheet').classList.toggle('collapsed', !open);
  $('toggle').textContent = open ? '▾' : '▴';
}
$('sheetHandle').addEventListener('click', () => { if (phone.matches) setSheet($('sheet').classList.contains('collapsed')); });

// ---------- Punkte: Start, Zwischenstopps, Ziel ----------

const MAX_STOPS = 8;
const COLORS = { start: '#2ec27e', via: '#a78bfa', end: '#e5252a' };
const pinIcon = (label, bg, size = 28) => L.divIcon({
  className: '', html: `<div class="pin" style="background:${bg};width:${size}px;height:${size}px">${label}</div>`,
  iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});

// Gesetzte Punkte in Fahrreihenfolge (ohne Lücken). Der erste ist Start, der letzte Ziel.
const pointList = () => (S.mode === 'ab' ? [S.start, ...S.vias, S.end] : [S.start]).filter(Boolean);

// Rolle eines Punkts an Position i: [Pin-Text, Name, Farbe]
function role(i, n) {
  if (i === 0) return ['S', 'Start', COLORS.start];
  if (i === n - 1 && S.mode === 'ab' && S.end) return ['Z', 'Ziel', COLORS.end];
  return [i, `Stopp ${i}`, COLORS.via];
}

// Neue Reihenfolge übernehmen: erster = Start, letzter = Ziel, dazwischen Stopps
function setPoints(arr) {
  S.start = arr[0] || null;
  S.end = S.mode === 'ab' && arr.length > 1 ? arr[arr.length - 1] : null;
  S.vias = S.mode === 'ab' ? arr.slice(1, -1) : [];
  renderMarkers();
  updateUI();
}

const removePoint = i => { const arr = pointList(); arr.splice(i, 1); setPoints(arr); };
const movePoint = (from, to) => { const arr = pointList(); arr.splice(to, 0, ...arr.splice(from, 1)); setPoints(arr); };

// Neuer Zwischenstopp dort einsortieren, wo er (Luftlinie) den kleinsten Umweg macht
function addVia(p) {
  const seq = pointList();
  let best = 0, bestCost = Infinity;
  for (let i = 0; i < seq.length - 1; i++) {
    const c = R.haversine(seq[i], p) + R.haversine(p, seq[i + 1]) - R.haversine(seq[i], seq[i + 1]);
    if (c < bestCost) { bestCost = c; best = i; }
  }
  S.vias.splice(best, 0, p);
}

// Alle Punkt-Marker neu aufbauen (Beschriftung hängt von der Position ab)
function renderMarkers() {
  for (const m of S.pointMarkers) m.remove();
  const pts = pointList();
  S.pointMarkers = pts.map((p, i) => {
    const [label, name, bg] = role(i, pts.length);
    const m = L.marker(p, { icon: pinIcon(label, bg, label === 'S' || label === 'Z' ? 28 : 24), draggable: true, title: name }).addTo(map);
    m.on('dragend', () => { const arr = pointList(); arr[i] = [m.getLatLng().lat, m.getLatLng().lng]; setPoints(arr); });
    if (S.mode === 'ab') {
      m.bindPopup(`<button class="popdel">${name} entfernen</button>`);
      // Leaflet stoppt Klicks im Popup, daher Handler direkt am Knopf
      m.on('popupopen', e => { e.popup.getElement().querySelector('.popdel').onclick = () => { map.closePopup(); removePoint(i); }; });
    }
    return m;
  });
}

// ---------- Ortsnamen & Routenliste ----------

const nameKey = p => p.map(v => v.toFixed(4)).join(',');
function placeName(p) {
  const k = nameKey(p);
  if (!S.names.has(k) && isOnline()) { // offline: Koordinaten zeigen, später erneut versuchen
    S.names.set(k, null); // nur einmal anfragen
    timed('Photon', fetch(`${CONFIG.geocoderUrl}reverse?lat=${p[0]}&lon=${p[1]}&lang=de`))
      .then(r => r.json())
      .then(j => {
        const pr = j.features?.[0]?.properties || {};
        const name = [pr.name || pr.street, pr.city || pr.town || pr.village || pr.district].filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i).join(', ');
        S.names.set(k, name || null);
        if (!S.dragging) renderStops();
      })
      .catch(() => {});
  }
  return S.names.get(k) || `${p[0].toFixed(4)}, ${p[1].toFixed(4)}`;
}

function renderStops() {
  if (S.mode !== 'ab' || S.dragging) return;
  const pts = pointList();
  const fresh = !!S.result && S.resultKey === inputKey();
  const legs = fresh ? S.result.route.legs || [] : [];
  const pin = (label, bg) => `<span class="pin sm" style="background:${bg}">${label}</span>`;
  const rows = [];
  pts.forEach((p, i) => {
    const [label, name, bg] = role(i, pts.length);
    rows.push(`<li class="pt" data-idx="${i}">
      ${pts.length > 1 ? '<span class="grip" title="Ziehen zum Umsortieren">⠿</span>' : ''}
      ${pin(label, bg)}<span class="nm"><small>${name}</small>${placeName(p)}</span>
      <button data-del="${i}" title="${name} entfernen">×</button></li>`);
    // Etappe zum nächsten Punkt: Länge, Kurvenanteil, Fahrzeit (nach der Berechnung)
    if (i < pts.length - 1) {
      const l = legs[i];
      rows.push(`<li class="leg${l ? ' has' : ''}">${l ? `${km(l.len)} · ${pct(l.curvyLen / (l.len || 1))} kurvig · ${hm(l.time)}${l.up != null ? ` · ↑ ${Math.round(l.up)} m` : ''}` : ''}</li>`);
    }
  });
  // Platzhalter für noch fehlende Punkte
  if (!S.start) rows.push(`<li class="pt">${pin('S', COLORS.start)}<span class="nm"><small>Start</small><i>auf Karte tippen</i></span></li>`);
  if (!S.end) rows.push(`<li class="pt">${pin('Z', COLORS.end)}<span class="nm"><small>Ziel</small><i>${S.start ? 'auf Karte tippen' : '–'}</i></span></li>`);
  else if (S.vias.length < MAX_STOPS) rows.push('<li class="addhint">+ Weitere Taps auf die Karte fügen Zwischenstopps hinzu · ⠿ ziehen zum Umsortieren</li>');
  $('stops').innerHTML = rows.join('');
}

$('stops').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-del]');
  if (b) removePoint(+b.dataset.del);
});

// Drag & Drop per Pointer-Events (Maus und Touch; HTML5-DnD geht auf Handys nicht zuverlässig)
$('stops').addEventListener('pointerdown', ev => {
  const grip = ev.target.closest('.grip');
  if (!grip || S.busy) return;
  ev.preventDefault();
  const li = grip.closest('li'), from = +li.dataset.idx;
  const items = [...$('stops').querySelectorAll('li[data-idx]')];
  const mids = items.map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
  const step = items.length > 1 ? mids[1] - mids[0] : 0; // Zeilenabstand
  const y0 = ev.clientY;
  let to = from;
  S.dragging = true;
  li.classList.add('dragging');
  grip.setPointerCapture(ev.pointerId);

  const move = e => {
    const dy = e.clientY - y0;
    li.style.transform = `translateY(${dy}px)`;
    // Zielposition = Anzahl der anderen Zeilen, deren Mitte oberhalb der gezogenen Zeile liegt
    to = mids.filter((m, i) => i !== from && m < mids[from] + dy).length;
    items.forEach((el, i) => {
      if (i === from) return;
      const shift = from < to && i > from && i <= to ? -step : from > to && i >= to && i < from ? step : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const end = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    S.dragging = false;
    items.forEach(el => { el.style.transform = ''; });
    li.classList.remove('dragging');
    if (to !== from) movePoint(from, to);
    else renderStops();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
});

map.on('click', ev => {
  const p = [ev.latlng.lat, ev.latlng.lng];
  if (S.mode === 'loop' || !S.start) S.start = p;
  else if (!S.end) S.end = p;
  else if (S.vias.length >= MAX_STOPS) { status(`Maximal ${MAX_STOPS} Zwischenstopps.`, true); return; }
  else addVia(p);
  S.error = null;
  if (phone.matches) setSheet(false); // Karte frei halten, die Aktionsleiste bleibt sichtbar
  renderMarkers();
  updateUI();
});

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return status('Standort wird nicht unterstützt', true);
  status('Suche Standort …');
  navigator.geolocation.getCurrentPosition(
    pos => {
      S.start = [pos.coords.latitude, pos.coords.longitude];
      map.setView(S.start, Math.max(map.getZoom(), 12));
      status('Start auf deinen Standort gesetzt.');
      renderMarkers();
      updateUI();
    },
    err => status('Standort nicht verfügbar: ' + err.message, true),
    { enableHighAccuracy: true, timeout: 15000 },
  );
});

// ---------- Berechnung ----------

// Lädt bei Bedarf Straßendaten nach und berechnet die Route durch pts.
// Genutzt von „Berechnen“ und vom Fahrmodus (Neuberechnung unterwegs).
// localRoads = false (unterwegs): keine Nebenstraßen nachladen, damit ohne Netz neu berechnet werden kann.
async function calcRoute(pts, mode, opt, onProgress = () => {}, { localRoads = true } = {}) {
  const bbox = mode === 'ab' ? R.bboxForPoints(pts) : R.bboxForLoop(pts[0], opt.targetKm);
  // Start → Ziel: reicht, wenn alle Punkte mit ~2 km Rand im geladenen Bereich liegen
  const covered = mode === 'ab'
    ? !!S.bbox && pts.every(([lat, lon]) => R.bboxContains(S.bbox, [lat - 0.02, lon - 0.03, lat + 0.02, lon + 0.03]))
    : R.bboxContains(S.bbox, bbox);
  // Punkte ohne geladene Nebenstraßen in der Nähe (z. B. Marker verschoben)
  const missing = localRoads ? pts.filter(p => !S.focus.some(f => R.haversine(p, f) < R.LOCAL_RADIUS * 0.8)) : [];
  if (!covered || missing.length) {
    const t0 = performance.now();
    const full = !covered;
    onProgress(`Schritt 1/2: Lade ${full ? 'Straßendaten' : 'Nebenstraßen'} …`);
    const area = await loadArea(full ? bbox : null, full ? pts : missing, info =>
      onProgress(`Schritt 1/2: Lade ${full ? 'Straßendaten' : 'Nebenstraßen'} … ${info}${/Overpass|Versuch/.test(info) ? ' (kann 10–90 s dauern)' : ''}`));
    if (full) { S.ways = new Map(); S.rels = new Map(); S.focus = []; S.bbox = area.rect; S.dem = area.dem; }
    for (const el of area.elements) (el.type === 'relation' ? S.rels : S.ways).set(el.id, el);
    S.focus.push(...(full ? pts : missing));
    const lm = R.metrics.load, st = area.stat;
    log('netz', lm.fromCache ? `komplett aus dem Kachel-Cache (${st.tilesCached} Kacheln, ${st.localCached} Umkreise)`
      : `${lm.source === 'Straßenpakete' ? 'Straßenpakete' : `Overpass ${lm.winner}`}: ${Math.round(lm.bytes / 1000)} KB in ${(lm.ms / 1000).toFixed(1)} s · Cache: ${st.tilesCached} Kacheln vorhanden, ${st.tilesLoaded} neu`);
    onProgress(`Schritt 1/2: Baue Straßennetz aus ${S.ways.size.toLocaleString('de')} Wegen …`);
    await setNetwork(`geladen in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  onProgress('Schritt 2/2: Berechne Route …');
  return engine.route(pts, mode, opt);
}

// Straßennetz im Rechenkern (neu) aufbauen und Heatmap aktualisieren
async function setNetwork(info) {
  const n = await engine.setWays([...S.ways.values(), ...S.rels.values()], S.dem);
  S.net = n;
  S.loadInfo = `${n.nodes.toLocaleString('de')} Knoten, ${n.edges.toLocaleString('de')} Kanten, ${info}`;
  drawHeat();
}

// Wird nur von „Berechnen“ und „Neu würfeln“ ausgelöst, nie automatisch
async function compute() {
  if (S.busy || !ready()) return;
  const pts = routePoints();
  const key = inputKey();
  S.busy = true; S.error = null;
  progress('Berechne …');
  try {
    const t1 = performance.now();
    S.result = await calcRoute(pts, S.mode, { ...options(), alternatives: true }, progress);
    S.resultKey = key; // wurden währenddessen Eingaben geändert, gilt die Route sofort als veraltet
    log('route', `${(S.result.route.len / 1000).toFixed(1)} km, ${Math.round(S.result.route.curvyLen / S.result.route.len * 100)} % kurvig, ${Math.round(R.metrics.route?.ms ?? 0)} ms Rechenzeit`);
    drawRoute(); drawStats(); renderAlts(); updateConditions();
    status(`Fertig nach ${((performance.now() - t1) / 1000).toFixed(1)} s · Straßennetz: ${S.loadInfo}`);
  } catch (err) {
    console.error(err);
    S.error = err.message;
    log('fehler', err.message);
    status('Fehler: ' + err.message, true);
  } finally {
    S.busy = false;
    updateUI();
  }
}

// ---------- Zeichnen ----------

const FEATURE_LABEL = Object.fromEntries(FEATURES.map(f => [f.key, f.label]));
function edgeTip(e) {
  const feats = Object.keys(e.f || {}).map(k => FEATURE_LABEL[k]).join('<br>');
  return `<b>${e.name || '(ohne Namen)'}</b><br>${e.hw} · ${km(e.len)}<br>Kurvigkeit ${pct(e.curv)}${feats ? `<br><span style="color:#ffd23f">${feats}</span>` : ''}`;
}

async function drawHeat() {
  const edges = S.net ? await engine.heat(0.08) : [];
  S.heatLayer.clearLayers();
  for (const e of edges) {
    L.polyline(e.geom, { color: color(e.curv), weight: 2 + 3 * e.curv, opacity: 0.8 }).bindTooltip(edgeTip(e), { sticky: true }).addTo(S.heatLayer);
  }
}

function drawRoute(fit = true) {
  const { route, base, snapped, waypoints } = S.result;
  S.routeLayer.clearLayers();
  // andere Varianten grau (antippen wählt sie aus); ohne Varianten wie bisher die schnellste Route gestrichelt
  const others = (S.result.alternatives || []).filter(a => a.key !== S.result.selected);
  for (const a of others) {
    L.polyline(a.route.coords, { color: $('dark').checked ? '#9aa0a8' : '#59606a', weight: 6, opacity: 0.55, dashArray: a.key === 'fast' ? '6 8' : null })
      .bindTooltip(`${a.label}: ${km(a.route.len)} · ${pct(a.route.curvyLen / a.route.len)} kurvig – antippen zum Wählen`, { sticky: true })
      .on('click', ev => { L.DomEvent.stop(ev); selectAlt(a.key); }).addTo(S.routeLayer);
  }
  if (base && !S.result.alternatives?.length) L.polyline(base.coords, { color: '#888', weight: 4, dashArray: '6 8', opacity: 0.9 }).addTo(S.routeLayer);
  L.polyline(route.coords, { color: '#000', weight: 10, opacity: 0.9 }).addTo(S.routeLayer);
  for (const ed of route.steps) {
    L.polyline(ed.geom, { color: color(ed.curv), weight: 6, opacity: 1 }).bindTooltip(edgeTip(ed), { sticky: true }).addTo(S.routeLayer);
  }
  // Wo wurde auf das Straßennetz eingerastet?
  const clicked = S.result.points;
  snapped.forEach((p, i) => clicked[i] && L.polyline([clicked[i], p], { color: '#fff', weight: 2, dashArray: '2 4' }).addTo(S.routeLayer));
  waypoints.forEach((p, i) => L.circleMarker(p, { radius: 6, color: '#111', fillColor: '#fff', fillOpacity: 1, weight: 2 })
    .bindTooltip('Wegpunkt ' + (i + 1)).addTo(S.routeLayer));
  S.routeLayer.eachLayer(l => { l.baseOpacity = l.options.opacity; });
  if (!fit) return;
  const pad = phone.matches ? { paddingTopLeft: [20, 80], paddingBottomRight: [20, innerHeight * 0.55] } : { paddingTopLeft: [460, 40], paddingBottomRight: [40, 40] };
  map.fitBounds(route.coords, pad);
}

function drawStats() {
  const { route, base } = S.result;
  const col = (r, f) => r ? f(r) : '–';
  const rows = [
    ['Länge', r => km(r.len)],
    ['Fahrzeit (ca.)', r => hm(r.time)],
    ['Kurvige Strecke', r => `${km(r.curvyLen)} (${pct(r.curvyLen / r.len)})`],
    ['Ø Kurvigkeit', r => pct(r.avgCurv)],
    ['Höhenmeter ↑ / ↓', r => (r.up != null ? `${Math.round(r.up)} / ${Math.round(r.down)} m` : '–')],
  ];
  if (!base) rows.push(['Doppelt gefahren', r => km(r.reuse)]);
  const note = route.curvyUsed < options().curvy - 1e-6
    ? `<p class="hint">Umweg-Limit erreicht: Kurvenlust automatisch auf ${pct(route.curvyUsed)} reduziert.</p>` : '';
  $('stats').innerHTML = `<table><tr><th></th><th>Kurvenroute</th><th>Schnellste</th></tr>
    ${rows.map(([n, f]) => `<tr><td>${n}</td><td>${col(route, f)}</td><td>${col(base, f)}</td></tr>`).join('')}</table>${note}`;
  $('summary').textContent = `${km(route.len)} · ${pct(route.curvyLen / route.len)} kurvig${route.up != null ? ` · ↑ ${Math.round(route.up)} m` : ''}`;
}

// ---------- Varianten ----------

function renderAlts() {
  const alts = S.result?.alternatives || [];
  $('alts').innerHTML = alts.length > 1 ? alts.map(a => {
    const r = a.route;
    return `<button data-alt="${a.key}" class="${a.key === S.result.selected ? 'on' : ''}"><div class="l">${a.label}</div>
      <div class="n">${km(r.len)} · ${hm(r.time)}<br>${pct(r.curvyLen / (r.len || 1))} kurvig${r.up != null ? ` · ↑ ${Math.round(r.up)} m` : ''}${a.key !== 'main' ? `<br>${pct(a.overlap)} gleich` : ''}</div></button>`;
  }).join('') : '';
}

function selectAlt(key) {
  const a = S.result?.alternatives?.find(x => x.key === key);
  if (!a || key === S.result.selected) return;
  Object.assign(S.result, { route: a.route, maneuvers: a.maneuvers, selected: key });
  log('route', `Variante „${a.label}“ gewählt: ${km(a.route.len)}, ${pct(a.route.curvyLen / a.route.len)} kurvig`);
  drawRoute(false); drawStats(); renderAlts(); updateUI(); updateConditions();
}
$('alts').addEventListener('click', ev => { const b = ev.target.closest('[data-alt]'); if (b) selectAlt(b.dataset.alt); });

// ---------- Unterwegs: Wetter und Sonne ----------

const pad2 = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const nextFive = () => Math.ceil(Date.now() / 300e3) * 300e3;

// Strecke zwischen zwei Distanzen als Linie (für die Markierungen auf der Karte)
function slice(track, from, to) {
  const pts = [pointAt(track, from)];
  track.coords.forEach((c, i) => { if (track.cum[i] > from && track.cum[i] < to) pts.push(c); });
  pts.push(pointAt(track, to));
  return pts;
}

let condSeq = 0;
async function updateConditions() {
  S.condLayer.clearLayers();
  if (!S.result) { $('cond').hidden = true; S.cond = null; return; }
  const seq = ++condSeq, depart = S.depart ?? nextFive();
  $('cond').hidden = false;
  $('depart').value = toLocalInput(depart);
  $('condSummary').textContent = 'Lade Wetter …';
  const cond = await routeConditions(S.result.route, depart);
  if (seq !== condSeq) return; // inzwischen neue Route oder Abfahrtszeit
  S.cond = cond;
  $('condSummary').textContent = cond.summary || cond.error || 'Keine Wetterdaten';
  $('condWarn').innerHTML = cond.warnings.map(w => `<li class="${w.kind}">${escHtml(w.text)}</li>`).join('')
    || '<li class="muted">Keine Warnungen für diese Abfahrtszeit</li>';
  // Abschnitte auf der Karte markieren: Blendung gelb, Regen/Gewitter blau
  const track = buildTrack(S.result.route.coords);
  for (const w of cond.warnings) {
    if (w.from == null || !['glare', 'rain', 'storm'].includes(w.kind)) continue;
    L.polyline(slice(track, w.from, Math.max(w.to, w.from + 300)), { color: w.kind === 'glare' ? '#ffd23f' : '#4f9bff', weight: 18, opacity: 0.35, interactive: false })
      .addTo(S.condLayer);
  }
  S.condLayer.addTo(map);
  S.routeLayer.remove().addTo(map); // Route über den Markierungen
  log('wetter', `${cond.summary || cond.error || '–'}${cond.warnings.length ? ` · ${cond.warnings.length} Warnung(en)` : ''}`);
}
$('depart').addEventListener('change', () => { const v = new Date($('depart').value).getTime(); S.depart = Number.isFinite(v) ? v : null; updateConditions(); });
$('departNow').addEventListener('click', () => { S.depart = null; updateConditions(); });

function reset() {
  S.start = S.end = S.result = S.resultKey = S.error = null;
  S.vias = []; renderMarkers();
  S.routeLayer.clearLayers();
  S.condLayer.clearLayers(); S.cond = null; condSeq++; $('cond').hidden = true; $('alts').innerHTML = '';
  $('stats').innerHTML = ''; $('summary').textContent = ''; status('');
  updateUI();
}

// ---------- GPX ----------

async function shareGPX() {
  const name = S.mode === 'ab' ? 'Kurvenroute' : `Rundtour ${$('len').value} km`;
  const pts = S.result.points, last = pts.length - 1;
  const wpts = pts.map((p, i) => ({ lat: p[0], lon: p[1],
    name: `${i === 0 ? 'Start' : i === last ? 'Ziel' : `Stopp ${i}`}: ${placeName(p)}` }));
  if (S.mode === 'loop') wpts.length = 1;
  return shareFile(name, R.toGPX(S.result.route.coords, name, wpts));
}

// GPX-Datei teilen (nativ über das Teilen-Menü, im Browser per Web Share oder Download)
async function shareFile(name, xml) {
  const file = name.replace(/[^\wäöüÄÖÜß-]+/g, '_') + '.gpx';
  if (native) {
    const { uri } = await Filesystem.writeFile({ path: file, data: xml, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, files: [uri], dialogTitle: 'GPX öffnen mit …' });
    return;
  }
  const blob = new File([xml], file, { type: 'application/gpx+xml' });
  if (navigator.canShare?.({ files: [blob] })) return navigator.share({ files: [blob], title: name });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- Bedienelemente ----------

function setMode(mode) {
  S.mode = mode;
  document.body.dataset.active = mode;
  document.querySelectorAll('[data-set-mode]').forEach(b => b.classList.toggle('on', b.dataset.setMode === mode));
  reset();
}
document.querySelectorAll('[data-set-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.setMode)));

// Einstellungen ändern rechnet nicht neu, markiert die Route aber als veraltet
['curvy', 'detour', 'len'].forEach(id => $(id).addEventListener('input', () => { updateLabels(); updateUI(); }));
$('avoid').addEventListener('change', updateUI);
$('heat').addEventListener('change', () => {
  if (!$('heat').checked) return S.heatLayer.remove();
  S.heatLayer.addTo(map);
  S.routeLayer.remove().addTo(map); // Route über der Heatmap halten
});
$('go').addEventListener('click', compute);
$('reroll').addEventListener('click', () => { S.seed++; compute(); });
$('reset').addEventListener('click', reset);
$('gpx').addEventListener('click', () => shareGPX().catch(err => {
  if (!/cancel|abort/i.test(err.message)) status('GPX fehlgeschlagen: ' + err.message, true);
}));

$('search').addEventListener('keydown', async ev => {
  if (ev.key !== 'Enter' || !ev.target.value.trim()) return;
  ev.target.blur(); // Tastatur schließen
  if (!isOnline()) return flash('Die Ortssuche braucht Internet. Tippe den Ort direkt auf der Karte an.');
  try {
    // Orte nahe dem Kartenausschnitt bevorzugen (sonst gewinnt z. B. Münsingen in der Schweiz statt auf der Alb)
    const c = map.getCenter();
    const res = await timed('Photon', fetch(`${CONFIG.geocoderUrl}api/?limit=1&lang=de&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&q=${encodeURIComponent(ev.target.value)}`));
    const f = (await res.json()).features?.[0];
    if (!f) return status('Ort nicht gefunden', true);
    const [lon, lat] = f.geometry.coordinates;
    map.setView([lat, lon], 12);
    status('');
    if (phone.matches) setSheet(false);
  } catch (err) { status('Suche fehlgeschlagen: ' + err.message, true); }
});

// ---------- Routen speichern und laden ----------

let flashTimer;
function flash(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}

const shortName = p => placeName(p).split(',')[0];

$('save').addEventListener('click', () => {
  const pts = routePoints();
  $('saveName').value = S.mode === 'ab'
    ? `${shortName(pts[0])} → ${shortName(pts[pts.length - 1])}`
    : `Rundtour ${$('len').value} km ab ${shortName(pts[0])}`;
  $('saveDlg').hidden = false;
  setTimeout(() => $('saveName').select(), 50);
});
$('saveCancel').addEventListener('click', () => { $('saveDlg').hidden = true; });
$('saveForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = $('saveName').value.trim() || 'Meine Route';
  $('saveDlg').hidden = true;
  const r = S.result.route, pts = routePoints();
  // Plan + Einstellungen + Straßendaten: damit lässt sich die Route später ohne Download neu berechnen und fahren
  const data = {
    v: 1, mode: S.mode, points: pts,
    names: Object.fromEntries(pts.map(p => [nameKey(p), S.names.get(nameKey(p))]).filter(([, n]) => n)),
    settings: { curvy: +$('curvy').value, detour: +$('detour').value, len: +$('len').value, avoid: $('avoid').checked, seed: S.seed },
    bbox: S.bbox, focus: S.focus, selected: S.result.selected || 'main',
    ways: packWays([...S.ways.values()].filter(w => w.geometry?.length === w.nodes?.length)),
    rels: packRels([...S.rels.values()]),
    dem: S.dem && { z: S.dem.z, tiles: [...S.dem.tiles].map(([k, t]) => [k, int16ToBase64(t)]) },
  };
  try {
    await saveRoute({ name, created: Date.now(), mode: S.mode, len: r.len, time: r.time, curvy: r.curvyLen / (r.len || 1), stops: S.vias.length }, data);
    flash(`„${name}“ gespeichert`);
    log('speicher', `„${name}“ gespeichert (${data.ways.length} Wege)`);
  } catch (err) {
    flash('Speichern fehlgeschlagen: ' + err.message);
  }
});

async function renderLibrary() {
  const list = await listRoutes();
  const date = t => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  $('libList').innerHTML = list.length ? list.map(m => `<li>
      <div class="t">${m.name.replace(/</g, '&lt;')}</div>
      <div class="m">${date(m.created)} · ${km(m.len)} · ${pct(m.curvy)} kurvig · ${hm(m.time)}${m.mode === 'loop' ? ' · Rundtour' : m.stops ? ` · ${m.stops} Stopp${m.stops > 1 ? 's' : ''}` : ''}</div>
      <div class="b"><button data-load="${m.id}">Laden</button><button class="danger" data-delete="${m.id}">Löschen</button></div>
    </li>`).join('')
    : '<li class="empty">Noch keine Routen gespeichert. Berechne eine Route und tippe auf „Speichern“.</li>';
}

async function loadSaved(id) {
  const d = await loadRoute(id);
  if (!d) return flash('Route nicht gefunden');
  $('library').hidden = true;
  setMode(d.mode);
  $('curvy').value = d.settings.curvy; $('detour').value = d.settings.detour; $('len').value = d.settings.len;
  $('avoid').checked = d.settings.avoid; S.seed = d.settings.seed;
  updateLabels();
  // gespeicherte Straßendaten übernehmen, damit ohne Netz neu berechnet werden kann
  log('speicher', `Route geladen (${d.ways.length} Wege)`);
  S.ways = new Map(unpackWays(d.ways).map(w => [w.id, w]));
  S.rels = new Map(unpackRels(d.rels || []).map(r => [r.id, r]));
  S.dem = d.dem ? { z: d.dem.z, tiles: new Map(d.dem.tiles.map(([k, b]) => [k, base64ToInt16(b)])) } : null;
  S.bbox = d.bbox; S.focus = d.focus;
  await setNetwork('aus gespeicherter Route');
  for (const [k, n] of Object.entries(d.names)) S.names.set(k, n);
  if (d.mode === 'ab') setPoints(d.points);
  else { S.start = d.points[0]; renderMarkers(); }
  drawHeat();
  await compute();
  if (d.selected && d.selected !== 'main') selectAlt(d.selected);
}

$('libBtn').addEventListener('click', async () => { await renderLibrary(); $('library').hidden = false; });
$('libClose').addEventListener('click', () => { $('library').hidden = true; });
$('libList').addEventListener('click', async ev => {
  const load = ev.target.closest('[data-load]'), del = ev.target.closest('[data-delete]');
  if (load) return loadSaved(load.dataset.load);
  if (!del) return;
  // Löschen erst beim zweiten Tippen
  if (!del.classList.contains('confirm')) {
    del.classList.add('confirm');
    del.textContent = 'Wirklich löschen?';
    setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Löschen'; }, 3000);
    return;
  }
  await deleteRoute(del.dataset.delete);
  renderLibrary();
});

// ---------- Kartenquelle: online (OSM/Topo) oder eigene Offline-Karte ----------

const offlineMap = offlineLayer(map);
const relief = reliefLayer(map); // Geländeschattierung aus dem Höhenmodell (ersetzt die Topo-Karte)

function applyMapSource() {
  const mode = $('mapSource').value;
  const off = mode === 'offline' || (mode === 'auto' && !isOnline());
  if (off) { map.removeLayer(base); offlineMap.addTo(map); } else { map.removeLayer(offlineMap); base.addTo(map); }
  // Die Offline-Karte hat ihre Schummerung schon eingebaut
  if ($('topo').checked && !off) relief.addTo(map); else map.removeLayer(relief);
  $('offlineChip').hidden = isOnline();
  try { localStorage.setItem('kj.mapSource', mode); } catch { /* egal */ }
}
try { $('mapSource').value = localStorage.getItem('kj.mapSource') || 'auto'; } catch { /* egal */ }
$('mapSource').addEventListener('change', applyMapSource);
$('topo').addEventListener('change', applyMapSource);
$('dark').addEventListener('change', () => { makeBase(); applyMapSource(); if (S.result) drawRoute(false); });
addEventListener('online', () => { applyMapSource(); log('netz', 'wieder online'); });
addEventListener('offline', () => { applyMapSource(); log('netz', 'offline'); });
addEventListener('kj-net', applyMapSource);
// nativ: zuverlässiger Netzstatus (die WebView meldet sonst oft „online“, obwohl das Netz weg ist)
if (native) {
  Network.getStatus().then(st => { net.native = st.connected; applyMapSource(); }).catch(() => {});
  Network.addListener('networkStatusChange', st => {
    net.native = st.connected;
    if (st.connected) markUp();
    log('netz', st.connected ? `wieder online (${st.connectionType})` : 'offline');
    applyMapSource();
  });
}
applyMapSource();

// ---------- Offline-Regionen ----------

let dl = null; // laufender Download { id, ctrl, text, pct }
const mb = b => `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB`;
const fmtDate = t => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const viewBbox = () => { const b = map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(v => +v.toFixed(4)); };

async function renderRegions() {
  const index = await listRegions(), byId = new Map(index.map(r => [r.id, r]));
  // laufender Ausschnitt-Download steht evtl. noch nicht im Index: trotzdem anzeigen
  const custom = [...index, ...(dl && !index.some(r => r.id === dl.id) ? [dl.region] : [])].filter(r => !PRESETS.some(p => p.id === r.id));
  const row = r => {
    const st = byId.get(r.id), est = estimate(r.bbox), running = dl?.id === r.id;
    const meta = running ? escHtml(dl.text)
      : st?.complete ? `✓ offline verfügbar · geladen am ${fmtDate(st.updated)} · ${st.stat.tiles} Kacheln, ${st.stat.places} Orte`
      : st ? 'Unvollständig – „Fortsetzen“ lädt den Rest' : `ca. ${mb(est.bytes)} · ${est.tiles} Kacheln`;
    const buttons = running ? '<button data-cancel>Abbrechen</button>'
      : st?.complete ? `<button data-dl="${r.id}" data-force>Aktualisieren</button><button class="danger" data-rdel="${r.id}">Löschen</button>`
      : `<button data-dl="${r.id}">${st ? 'Fortsetzen' : 'Herunterladen'}</button>${st ? `<button class="danger" data-rdel="${r.id}">Löschen</button>` : ''}`;
    return `<li id="reg-${r.id}"><div class="t">${escHtml(r.name)}</div><div class="m${st?.complete && !running ? ' ok' : ''}">${meta}</div>
      ${running ? `<div class="prog"><span style="width:${Math.round(dl.pct * 100)}%"></span></div>` : ''}<div class="b">${buttons}</div></li>`;
  };
  let viewRow;
  try {
    const bb = viewBbox(); checkBbox(bb);
    const est = estimate(bb);
    viewRow = `<li><div class="t">Aktueller Kartenausschnitt</div><div class="m">ca. ${mb(est.bytes)} · ${est.tiles} Kacheln</div><div class="b"><button data-view ${dl ? 'disabled' : ''}>Ausschnitt herunterladen</button></div></li>`;
  } catch (err) {
    viewRow = `<li><div class="t">Aktueller Kartenausschnitt</div><div class="m">${escHtml(err.message)}</div></li>`;
  }
  $('regionList').innerHTML = [...PRESETS, ...custom].map(row).join('') + viewRow;
}

function showProgress() {
  const li = dl && document.getElementById(`reg-${dl.id}`);
  if (!li) return;
  li.querySelector('.m').textContent = dl.text;
  const bar = li.querySelector('.prog span');
  if (bar) bar.style.width = `${Math.round(dl.pct * 100)}%`;
}

async function startDownload(region, force) {
  if (dl) return flash('Es läuft bereits ein Download');
  dl = { id: region.id, region, ctrl: new AbortController(), text: 'Starte …', pct: 0 };
  keepAwake(true);
  await renderRegions();
  const t0 = performance.now();
  try {
    const st = await downloadRegion(region, { force, signal: dl.ctrl.signal,
      onProgress: p => { dl.text = p.text; dl.pct = p.total ? p.done / p.total : 0; showProgress(); } });
    log('region', `„${region.name}“ geladen in ${Math.round((performance.now() - t0) / 1000)} s: ${st.tiles} Kacheln (${st.fetched} Abfragen, ${st.reused} wiederverwendet), ${st.places} Orte`);
    flash(`„${region.name}“ ist jetzt offline verfügbar`);
    offlineMap.refresh();
  } catch (err) {
    const aborted = err.name === 'AbortError';
    log(aborted ? 'region' : 'fehler', `${region.name}: ${aborted ? 'abgebrochen' : err.message}`);
    flash(aborted ? 'Abgebrochen – „Fortsetzen“ lädt den Rest' : `Download fehlgeschlagen: ${err.message}`);
  } finally {
    dl = null;
    keepAwake(false);
    renderRegions();
  }
}

document.querySelectorAll('[data-lib]').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.lib;
  document.querySelectorAll('[data-lib]').forEach(x => x.classList.toggle('on', x === b));
  $('libList').hidden = tab !== 'routes';
  $('regionPane').hidden = tab !== 'regions';
  $('ridePane').hidden = tab !== 'rides';
  if (tab === 'regions') renderRegions();
  if (tab === 'rides') prof.renderPane();
}));

$('regionList').addEventListener('click', async ev => {
  const t = ev.target.closest('button');
  if (!t) return;
  if ('cancel' in t.dataset) { dl?.ctrl.abort(); t.textContent = 'Breche nach diesem Block ab …'; return; }
  if ('view' in t.dataset) return startDownload({ id: `view-${Date.now()}`, name: `Ausschnitt vom ${fmtDate(Date.now())}`, bbox: viewBbox() });
  if (t.dataset.dl) {
    const region = PRESETS.find(p => p.id === t.dataset.dl) || (await listRegions()).find(r => r.id === t.dataset.dl);
    return startDownload(region, 'force' in t.dataset);
  }
  if (t.dataset.rdel) {
    if (!t.classList.contains('confirm')) {
      t.classList.add('confirm'); t.textContent = 'Wirklich löschen?';
      setTimeout(() => { t.classList.remove('confirm'); t.textContent = 'Löschen'; }, 3000);
      return;
    }
    await deleteRegion(t.dataset.rdel);
    log('region', `Region ${t.dataset.rdel} gelöscht`);
    offlineMap.refresh();
    renderRegions();
  }
});

// ---------- Fahrmodus ----------

const ride = initRide(map, S, {
  openBox: which => box.open(which),
  isFresh: () => !!S.result && S.resultKey === inputKey(),
  placeName,
  setName: (p, name) => S.names.set(nameKey(p), name),
  calcRoute: pts => calcRoute(pts, 'ab', options(), undefined, { localRoads: false }),
  // Kurvenlust ändern (Sprachbefehl „kurviger“), liefert den neuen Wert 0..1
  curvy: () => $('curvy').value / 100,
  setCurvy(delta) {
    $('curvy').value = Math.max(0, Math.min(100, +$('curvy').value + Math.round(delta * 100)));
    updateLabels();
    return $('curvy').value / 100;
  },
  // Neu berechnete Route aus dem Fahrmodus in die Planung übernehmen
  applyRideRoute(result, targets) {
    if (S.mode === 'ab') {
      S.start = result.points[0];
      S.end = targets[targets.length - 1].p;
      S.vias = targets.slice(0, -1).map(t => t.p);
      renderMarkers();
      S.resultKey = inputKey();
    }
    S.result = result;
    drawRoute(false); drawStats(); renderAlts(); updateUI(); updateConditions();
  },
  afterRide(rec) { updateUI(); if (S.result) drawRoute(); prof.afterRide(rec); },
});

// ---------- Fahrprofil ----------

const support = initSupport({ flash });
initAbout();

const prof = initProfile({
  engine, flash,
  afterRideSaved: n => support.maybeHint(n),
  // Profil geändert: Route gilt als veraltet (neu berechnen), bei neuen Kurven-Gewichten auch die Heatmap
  onChange(rebuild) { S.paramVer++; if (rebuild) drawHeat(); updateUI(); },
  showTrace(coords, name) {
    S.traceLayer.clearLayers();
    L.polyline(coords, { color: '#3d8bff', weight: 5, opacity: 0.9 })
      .bindTooltip(`Gefahren: ${escHtml(name)} – antippen zum Ausblenden`, { sticky: true })
      .on('click', ev => { L.DomEvent.stop(ev); S.traceLayer.clearLayers(); }).addTo(S.traceLayer);
    map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
  },
  shareGpx: (coords, name) => shareFile(name, R.toGPX(coords, name, [])).catch(err => {
    if (!/cancel|abort/i.test(err.message)) flash('GPX fehlgeschlagen: ' + err.message);
  }),
});

// ---------- Boxengasse ----------

const box = initBoxengasse({
  S, ride, prof,
  app: {
    flash,
    // Parameter-Labor: neue Parameter übernehmen, bei Bedarf Kurvigkeit neu messen und neu berechnen
    async labApply(rebuild) {
      S.paramVer++;
      await engine.setParams(rebuild);
      if (rebuild) drawHeat();
      log('labor', rebuild ? 'Parameter geändert, Netz neu vermessen' : 'Parameter geändert');
      if (!ready()) { updateUI(); return false; }
      await compute();
      return !!S.result && !S.error;
    },
  },
});
// 7× aufs Logo tippen schaltet die Boxengasse frei (klappt das Panel dabei nicht auf/zu)
document.querySelector('#sheetHandle h1').addEventListener('click', ev => { ev.stopPropagation(); box.tap(); });
$('rideInfo').addEventListener('click', () => { if (box.isUnlocked()) box.open('fahrt'); });

updateLabels();
updateUI();

// Offline-Shell für die installierbare Web-App (in der nativen App nicht nötig)
if (!native && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
