// Boxengasse: verstecktes Technik-Fenster.
// Für Fahrer Infotainment („wie kommt meine Route zustande?“), für uns Telemetrie, Debugging und Parameter-Labor.
// Freischalten: 7× schnell auf das Logo „Kurvenjäger“ tippen, Sprachbefehl „Boxengasse“ oder URL-Parameter ?boxengasse.
import { Capacitor } from '@capacitor/core';
import * as R from './router.js';
import { events, services, counters } from './telemetry.js';
import { canListen, voiceEnabled } from './speech.js';
import { listRoutes, cacheKeys, cacheClear } from './store.js';
import { engine, engineInfo } from './engine-client.js';
import { FEATURES } from './features.js';
import { profile as demProfile } from './dem.js';
import { listRegions } from './regions.js';
import { isOnline } from './tiles.js';
import { weatherText, LIMITS } from './weather.js';
import { sunPosition } from './sun.js';
import { TAGS, BAND_GROUPS } from './profile.js';
import { CONFIG } from './config.js';
import pkg from '../package.json';

const $ = id => document.getElementById(id);
const PREF = 'kj.box';
const TAPS = 7;
const TABS = [['ueberblick', 'Überblick'], ['route', 'Route'], ['netz', 'Netz'], ['fahrt', 'Fahrt'], ['profil', 'Profil'], ['labor', 'Labor'], ['system', 'System'], ['log', 'Log']];
const CLASS_LABEL = { motorway: 'Autobahn', trunk: 'Kraftfahrstraße', primary: 'Bundesstraße', secondary: 'Landesstraße', tertiary: 'Kreisstraße', unclassified: 'Nebenstraße', residential: 'Wohnstraße', living_street: 'Spielstraße' };
const SCALARS = [
  ['step', 'Abtastabstand Kurvigkeit (m)', 1, true],
  ['curveMin', 'Ab hier gilt ein Abschnitt als kurvig', 0.01],
  ['curveSat', 'Ab hier voller Kurvenbonus', 0.01],
  ['bonus', 'Max. Rabatt für kurvige Abschnitte', 0.05],
  ['slowdown', 'Tempoverlust in Kurven', 0.05],
  ['reusePenalty', 'Strafe für doppelt Gefahrenes', 0.5],
  ['loopShape', 'Rundtour: Länge / Kreisradius', 0.1],
];

const fmtMs = v => v == null ? '–' : v < 10 ? `${v.toFixed(1)} ms` : v < 2000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
const fmtKb = b => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
const km = m => `${(m / 1000).toFixed(1)} km`;
const pct = x => `${Math.round(x * 100)} %`;
const signedPct = x => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`;
const num = n => Math.round(n).toLocaleString('de');
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `vor ${s} s` : s < 3600 ? `vor ${Math.round(s / 60)} min` : `vor ${Math.round(s / 3600)} h`; };
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const kv = rows => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const bandLabels = () => [...R.P.bands.map(([r], i) => i === 0 ? `< ${r} m` : `${R.P.bands[i - 1][0]}–${r} m`), 'gerade'];
const BAND_COLORS = ['#e01b24', '#ff7a1a', '#f5c211', '#2ec27e', '#4f7bd9', '#5a5f68'];

export const boxUnlocked = () => { try { return localStorage.getItem(PREF) === '1'; } catch { return false; } };

// Gestapelter Balken mit Legende
function stack(parts) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return `<div class="stack">${parts.map(p => `<span style="width:${(p.v / total * 100).toFixed(2)}%;background:${p.c}" title="${esc(p.label)}"></span>`).join('')}</div>
    <ul class="legend2">${parts.filter(p => p.v > 0).map(p => `<li><i style="background:${p.c}"></i>${esc(p.label)} <b>${p.text}</b></li>`).join('')}</ul>`;
}

export function initBoxengasse({ S, app, ride, prof }) {
  let tab = 'ueberblick', timer = null, taps = 0, tapTimer, sttOk = null, storage = null, saved = null, cacheCount = null;
  let netStats = null, netKey = null, regions = null;
  const labHistory = [];
  const cache = new WeakMap(); // teure Auswertungen je Graph/Route nur einmal rechnen
  const memo = (obj, key, fn) => { if (!obj) return null; const c = cache.get(obj) || {}; cache.set(obj, c); return c[key] ??= fn(); };

  // ---------- Öffnen, Freischalten ----------

  function open(which) {
    if (which) tab = which;
    $('box').hidden = false;
    renderTabs(); render();
    clearInterval(timer);
    timer = setInterval(() => { if (tab !== 'labor' && !$('box').hidden) render(); }, 1000);
  }
  function close() { $('box').hidden = true; clearInterval(timer); }
  function updateEntry() { document.body.classList.toggle('box-unlocked', boxUnlocked()); }
  function unlock() { try { localStorage.setItem(PREF, '1'); } catch { /* egal */ } updateEntry(); }
  function lock() { try { localStorage.removeItem(PREF); } catch { /* egal */ } close(); updateEntry(); app.flash('Boxengasse gesperrt'); }

  // 7× aufs Logo tippen wie beim Android-Entwicklermodus
  function tap() {
    if (boxUnlocked()) return open();
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 2500);
    if (taps >= TAPS) { taps = 0; unlock(); app.flash('Boxengasse freigeschaltet'); open('ueberblick'); }
    else if (taps >= 3) app.flash(`Noch ${TAPS - taps}× tippen bis zur Boxengasse`);
  }

  // ---------- Rahmen ----------

  function renderTabs() {
    $('boxTabs').innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('');
  }
  function render() {
    const fn = { ueberblick, route, netz, fahrt, profil, labor, system, log }[tab];
    $('boxBody').innerHTML = fn();
    if (tab === 'labor') bindLab();
  }

  // ---------- Überblick ----------

  function ueberblick() {
    const { load, build, route: rt } = R.metrics;
    const stages = [
      ['Straßen laden', load?.fromCache ? 'Kachel-Cache' : load?.source === 'Straßenpakete' ? 'Straßenpakete · OpenStreetMap' : 'Overpass API · OpenStreetMap', load && !load.failed ? load.ms - (load.parseMs || 0) : null,
        (!load ? 'noch nichts geladen (oder aus gespeicherter Route)' : load.failed ? 'fehlgeschlagen'
          : load.fromCache ? `komplett aus dem Cache: ${load.cache.tilesCached} Kacheln, ${load.cache.localCached} Umkreise`
          : load.source === 'Straßenpakete' ? `${fmtKb(load.bytes)} Pakete · ${load.cache.tilesCached} Kacheln aus dem Cache, ${load.cache.tilesLoaded} geladen, Nebenstraßen um ${load.cache.localLoaded} Punkte${load.cache.uncovered ? ` · ${load.cache.uncovered} Kacheln nicht abgedeckt` : ''}`
          : `${fmtKb(load.bytes)} von ${load.winner}, Runde ${load.rounds}${load.cache ? ` · Cache: ${load.cache.tilesCached} Kacheln vorhanden, ${load.cache.tilesLoaded} neu` : ''}`)
          + (load?.cache?.localSkipped ? ` · ${load.cache.localSkipped} Nebenstraßen-Umkreise übersprungen (offline), Punkte rasten auf Hauptstraßen ein` : '')
          + (load?.cache?.offline ? ' · offline' : ''),
        'Holt alle Straßen im Kartenausschnitt – aus dem Kachel-Cache oder als fertige Straßenpakete (wöchentlich aus OpenStreetMap gebaut).', '#4f7bd9'],
      ['Höhenmodell laden', 'AWS Terrain Tiles (parallel)', load?.dem?.ms ?? null,
        load?.dem ? `Zoom ${load.dem.z}: ${load.dem.cached} Kacheln aus Cache, ${load.dem.loaded} geladen${load.dem.failed ? `, ${load.dem.failed} fehlgeschlagen` : ''}` : 'nicht geladen',
        'Holt Geländehöhen für Anstieg, Steigung und das Höhenprofil.', '#5dcaa5'],
      ['Antwort lesen', 'JSON-Parser', load?.parseMs, load?.elements ? `${num(load.elements)} Wege` : '', 'Wandelt die Server-Antwort in Daten um.', '#7f77dd'],
      ['Netz bauen', 'buildGraph', build ? build.ms - build.curvMs : null, build ? `${num(build.nodes)} Kreuzungen · ${num(build.edges)} Abschnitte` : '', 'Verbindet die Straßen an Kreuzungen zu einem Netz.', '#2ec27e'],
      ['Kurven vermessen', 'curviness', build?.curvMs, `alle ${R.P.step} m ein Kurvenradius`, 'Bewertet jeden Abschnitt von „gerade“ bis „Serpentine“.', '#f5c211'],
      ['Punkte einrasten', 'snapToRoad', rt?.snapMs, rt ? `${rt.legs ?? 1} Etappe(n)` : '', 'Setzt Start, Stopps und Ziel auf die nächste Straße.', '#ff7a1a'],
      ['Weg suchen', 'Dijkstra', rt?.searchMs, rt ? `${rt.runs} Suchläufe · ${num(rt.settled)} Kreuzungen geprüft` : '', 'Sucht den Weg, bei dem kurvige Straßen „billiger“ sind.', '#e01b24'],
    ];
    const total = stages.reduce((a, s, i) => a + (i === 1 ? 0 : s[2] || 0), 0); // Höhenmodell läuft parallel zum Laden
    const net = stages[0][2] || 0;
    const flow = ['OpenStreetMap', load?.source === 'Overpass' ? 'Overpass' : 'Straßenpakete', 'Straßennetz', 'Kurvigkeit', 'Kosten', 'Dijkstra', 'Route', 'Navigation'];
    return `
      <p class="lead">So entsteht deine Route. Alle Zeiten sind echte Messwerte der letzten Berechnung.</p>
      <div class="flow">${flow.map(f => `<span>${f}</span>`).join('<b>→</b>')}</div>
      <ol class="stages">${stages.map(([name, who, t, info, explain, c]) => `
        <li><div class="sh"><i style="background:${c}"></i><b>${name}</b><span class="mono">${fmtMs(t)}</span></div>
          <div class="bar"><span style="width:${total ? Math.max(t ? 1 : 0, (t || 0) / total * 100) : 0}%;background:${c}"></span></div>
          <div class="sub">${esc(explain)} <span class="muted">${esc(info)} · ${who}</span></div></li>`).join('')}
      </ol>
      <p class="muted small">Rechenkern läuft im <b>${engineInfo.mode}</b>${engineInfo.calls.route && rt ? ` · Übertragung Route ${fmtMs(Math.max(0, engineInfo.calls.route.ms - rt.ms))}` : ''}${engineInfo.error ? ` · Grund: ${esc(engineInfo.error)}` : ''}</p>
      ${total ? `<p class="callout">Rechnen: <b>${fmtMs(total - net)}</b> · Warten aufs Netz: <b>${fmtMs(net)}</b>${net ? ` · das Netz macht <b>${pct(net / total)}</b> der Zeit aus` : ''}.</p>` : ''}`;
  }

  // ---------- Route ----------

  function routeStats(res) {
    const bands = new Array(R.P.bands.length + 1).fill(0), classes = {}, profile = [], feats = {};
    let x = 0, runs = [];
    for (const ed of res.route.steps) {
      R.bendMeters(ed.geom).forEach((m, i) => { bands[i] += m; });
      for (const [k, v] of Object.entries(ed.f || {})) feats[k] = (feats[k] || 0) + ed.len * v;
      const cls = ed.hw.replace(/_link$/, '');
      classes[cls] = (classes[cls] || 0) + ed.len;
      profile.push([x, ed.len, ed.curv]);
      x += ed.len;
      // zusammenhängende Abschnitte gleichen Namens für die Top-Liste
      const last = runs[runs.length - 1];
      if (last && last.name === ed.name) { last.len += ed.len; last.cw += ed.curv * ed.len; }
      else runs.push({ name: ed.name || `${CLASS_LABEL[cls] || cls} (ohne Namen)`, len: ed.len, cw: ed.curv * ed.len, at: x - ed.len });
    }
    const top = runs.filter(r => r.len > 500).map(r => ({ ...r, curv: r.cw / r.len })).sort((a, b) => b.curv - a.curv).slice(0, 3);
    return { bands, classes, profile, total: x, top, feats };
  }

  function profileSvg(st, legEnds) {
    const W = 600, H = 110, max = Math.max(0.45, ...st.profile.map(p => p[2]));
    let d = `M0 ${H}`;
    for (const [x, len, c] of st.profile) {
      const x0 = x / st.total * W, x1 = (x + len) / st.total * W, y = H - c / max * (H - 8);
      d += ` L${x0.toFixed(1)} ${y.toFixed(1)} L${x1.toFixed(1)} ${y.toFixed(1)}`;
    }
    d += ` L${W} ${H} Z`;
    const ySat = H - R.P.curveSat / max * (H - 8);
    return `<svg class="profile" viewBox="0 0 ${W} ${H + 16}" preserveAspectRatio="none">
      <path d="${d}" fill="#e5252a55" stroke="#ff4d50" stroke-width="1.5"/>
      <line x1="0" x2="${W}" y1="${ySat}" y2="${ySat}" stroke="#e01b24" stroke-dasharray="4 4"/>
      ${legEnds.map(x => `<line x1="${x / st.total * W}" x2="${x / st.total * W}" y1="0" y2="${H}" stroke="#b9a6ff" stroke-width="2"/>`).join('')}
      <text x="4" y="${H + 13}" fill="#a7acb4" font-size="11">0 km</text>
      <text x="${W - 4}" y="${H + 13}" fill="#a7acb4" font-size="11" text-anchor="end">${km(st.total)}</text>
      <text x="${W - 4}" y="${ySat - 4}" fill="#e01b24" font-size="11" text-anchor="end">voller Kurvenbonus</text>
    </svg>`;
  }

  // Höhenprofil entlang der Route (aus dem Höhenmodell im Haupt-Thread)
  function elevationSvg(res) {
    if (!S.dem) return '';
    const h = memo(res, 'elev', () => demProfile(S.dem, res.route.coords, Math.max(30, res.route.len / 300)));
    const ok = h.filter(Number.isFinite);
    if (ok.length < 2) return '<p class="muted">Keine Höhendaten für diese Strecke.</p>';
    const W = 600, H = 110, lo = Math.min(...ok), hi = Math.max(...ok), span = Math.max(50, hi - lo);
    const pts = h.map((v, i) => `${(i / (h.length - 1) * W).toFixed(1)},${(H - ((Number.isFinite(v) ? v : lo) - lo) / span * (H - 10)).toFixed(1)}`);
    return `<svg class="profile" viewBox="0 0 ${W} ${H + 16}" preserveAspectRatio="none">
      <path d="M0,${H} L${pts.join(' L')} L${W},${H} Z" fill="#5dcaa555" stroke="#5dcaa5" stroke-width="1.5"/>
      <text x="4" y="12" fill="#a7acb4" font-size="11">${Math.round(hi)} m</text>
      <text x="4" y="${H + 13}" fill="#a7acb4" font-size="11">${Math.round(lo)} m · 0 km</text>
      <text x="${W - 4}" y="${H + 13}" fill="#a7acb4" font-size="11" text-anchor="end">${km(res.route.len)}</text>
    </svg>`;
  }

  // Wetter und Sonne je Wetterpunkt (aus der Planung)
  function weatherTable() {
    const c = S.cond;
    if (!c) return '';
    const time = ms => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dir = az => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];
    return `<h3>Wetter und Sonne unterwegs</h3>
      <p class="muted small">Abfahrt ${new Date(c.departMs).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · Open-Meteo (stündlich) · Sonnenstand berechnet${c.error ? ` · <span class="warn">${esc(c.error)}</span>` : ''}</p>
      <table class="tbl"><tr><th>km</th><th>Zeit</th><th>Wetter</th><th>°C</th><th>Regen</th><th>Böen</th><th>Sonne</th></tr>
        ${c.samples.map(s => { const sun = sunPosition(s.at, s.p[0], s.p[1]); return `<tr><td class="mono">${Math.round(s.d / 1000)}</td><td class="mono">${time(s.at)}</td>
          <td>${s.code != null ? esc(weatherText(s.code)) : '–'}</td><td class="mono">${s.temp != null ? Math.round(s.temp) : '–'}</td>
          <td class="mono ${s.prob >= LIMITS.rainProb ? 'warn' : ''}">${s.prob != null ? `${s.prob} % · ${s.mm} mm` : '–'}</td>
          <td class="mono ${s.gust >= LIMITS.gust ? 'warn' : ''}">${s.gust != null ? Math.round(s.gust) : '–'}</td>
          <td class="mono">${sun.altitude > 0 ? `${Math.round(sun.altitude)}° ${dir(sun.azimuth)}` : 'unter Horizont'}</td></tr>`; }).join('')}
      </table>
      ${c.glare.length ? `<p class="small">Blendung (Sonne unter ${25}° Höhe, höchstens ${35}° neben der Fahrtrichtung): ${c.glare.map(g => `km ${(g.from / 1000).toFixed(1)}–${(g.to / 1000).toFixed(1)}`).join(', ')}</p>` : ''}`;
  }

  function route() {
    const res = S.result;
    if (!res) return '<p class="lead">Noch keine Route berechnet. Setze Start und Ziel und tippe auf „Berechnen“.</p>';
    const r = res.route, b = res.base, rt = R.metrics.route;
    const st = memo(res, 'stats', () => routeStats(res));
    const legEnds = (r.legs || []).slice(0, -1).reduce((acc, l) => [...acc, (acc[acc.length - 1] || 0) + l.len], []);
    const labels = bandLabels();
    return `
      ${kv([
        ['Länge', `${km(r.len)}${b ? ` <span class="muted">(schnellste ${km(b.len)}, ${signedPct(r.len / b.len - 1)})</span>` : ''}`],
        ['Fahrzeit', `${Math.round(r.time / 60)} min${b ? ` <span class="muted">(schnellste ${Math.round(b.time / 60)} min)</span>` : ''}`],
        ['Kurvig (≥ ' + R.P.curveMin + ')', `${km(r.curvyLen)} · ${pct(r.curvyLen / r.len)}${b ? ` <span class="muted">(schnellste ${pct(b.curvyLen / b.len)})</span>` : ''}`],
        ['Ø Kurvigkeit', r.avgCurv.toFixed(3)],
        r.up != null ? ['Höhenmeter', `↑ ${Math.round(r.up)} m · ↓ ${Math.round(r.down)} m`] : null,
        ['Kurvenlust genutzt', rt?.trail ? rt.trail.map(v => pct(v)).join(' → ') : pct(r.curvyUsed ?? 0)],
        r.reuse ? ['Doppelt gefahren', km(r.reuse)] : null,
      ])}
      <h3>Kurvenprofil</h3>
      <p class="muted small">Kurvigkeit entlang der Strecke. Lila Linien: Zwischenstopps.</p>
      ${profileSvg(st, legEnds)}
      ${r.up != null ? `<h3>Höhenprofil</h3>
      <p class="muted small">↑ ${Math.round(r.up)} m · ↓ ${Math.round(r.down)} m · aus dem Höhenmodell (AWS Terrain Tiles, ~25–50 m Raster)</p>
      ${elevationSvg(res)}` : ''}
      ${rt?.arcSearches || rt?.turnBlocks ? `<p class="callout">Abbiegeverbote: ${rt.arcSearches}× hat die Suche wegen eines Verbots nachgerechnet, ${num(rt.turnBlocks)} verbotene Abbiegungen ausgeschlossen.</p>` : ''}
      ${weatherTable()}
      <h3>Kurven-Mix</h3>
      <p class="muted small">Wie viele Kilometer in welchem Kurvenradius gefahren werden.</p>
      ${stack(st.bands.map((m, i) => ({ v: m, c: BAND_COLORS[i] || '#5a5f68', label: labels[i], text: km(m) })))}
      <h3>Straßenarten</h3>
      ${stack(Object.entries(st.classes).sort((a, b) => b[1] - a[1]).map(([c, m], i) => ({ v: m, c: ['#ffa31a', '#4f7bd9', '#2ec27e', '#b9a6ff', '#f5c211', '#e01b24', '#5a5f68', '#888'][i], label: CLASS_LABEL[c] || c, text: km(m) })))}
      <h3>Besonderheiten der Strecke</h3>
      <ul class="top">${FEATURES.filter(f => st.feats[f.key] > 0).map(f => `<li>${esc(f.label)} <b class="mono">${km(st.feats[f.key])}</b> <span class="muted">Gewicht ${R.P.weights[f.key] ?? 0}</span></li>`).join('') || '<li class="muted">Keine – soweit OpenStreetMap Angaben hat (Abdeckung siehe „Netz“).</li>'}</ul>
      <h3>Kurvigste Abschnitte</h3>
      <ol class="top">${st.top.map(t => `<li><b>${esc(t.name)}</b> <span class="muted">${km(t.len)} ab km ${(t.at / 1000).toFixed(1)}</span> <span class="mono">${t.curv.toFixed(2)}</span></li>`).join('') || '<li class="muted">Keine Abschnitte über 500 m.</li>'}</ol>`;
  }

  // ---------- Netz ----------

  function netz() {
    const { load, build } = R.metrics;
    if (!S.net) return '<p class="lead">Noch kein Straßennetz geladen.</p>';
    // Statistik liegt im Rechenkern; nur neu holen, wenn sich das Netz geändert hat
    const key = `${build?.at}|${R.metrics.route?.at}`;
    if (key !== netKey) { netKey = key; engine.graphStats().then(st => { netStats = st; if (tab === 'netz') render(); }); }
    const st = netStats;
    if (!st) return '<p class="muted">Lade Netz-Statistik …</p>';
    const maxH = Math.max(...st.hist) || 1;
    return `
      ${kv([
        ['Kreuzungen (Knoten)', num(st.nodes)],
        ['Abschnitte (Kanten)', `${num(st.edges)}${st.dead ? ` <span class="muted">(+${st.dead} geteilt beim Einrasten)</span>` : ''}`],
        ['Straßenlänge gesamt', km(st.total)],
        ['Formpunkte', num(st.points)],
        ['Größtes Teilnetz', build ? pct(build.mainShare) + ' der Knoten' : '–'],
        ['Abbiegeverbote', st.turns ? `${num(st.turns.used)} angewendet an ${num(st.turns.via)} Kreuzungen${st.turns.skipped ? ` <span class="muted">(${st.turns.skipped} übersprungen: Via-Weg, Ausnahme Motorrad oder außerhalb)</span>` : ''}` : '–'],
        ['Höhenmodell', st.dem ? `Zoom ${st.dem.z}, ${st.dem.tiles} Kacheln` : '<span class="muted">nicht vorhanden</span>'],
        ['Speicher (geschätzt)', fmtKb(st.memory)],
        ['Gebiet', S.bbox ? S.bbox.map(v => v.toFixed(3)).join(', ') : '–'],
      ])}
      <h3>Straßenarten im Gebiet</h3>
      ${stack(Object.entries(st.classes).sort((a, b) => b[1] - a[1]).map(([c, m], i) => ({ v: m, c: ['#4f7bd9', '#2ec27e', '#ffa31a', '#b9a6ff', '#f5c211', '#e01b24', '#5a5f68', '#888'][i], label: CLASS_LABEL[c] || c, text: km(m) })))}
      <h3>Kurvigkeit aller Straßen</h3>
      <p class="muted small">Kilometer je Kurvigkeits-Stufe (0 = gerade). Rot gestrichelt: ab hier voller Kurvenbonus.</p>
      <div class="hist">${st.hist.map((v, i) => `<div title="${(i * 0.05).toFixed(2)}–${((i + 1) * 0.05).toFixed(2)}: ${km(v)}"><span style="height:${v / maxH * 100}%;background:${i * 0.05 >= R.P.curveSat ? '#e01b24' : i * 0.05 >= R.P.curveMin ? '#ffa31a' : '#4f7bd9'}"></span><small>${(i * 0.05).toFixed(2)}</small></div>`).join('')}</div>
      <h3>Datenabdeckung der Merkmale</h3>
      <p class="muted small">Für wie viel der Straßenlänge OSM überhaupt Angaben hat. Fehlt die Angabe, zählt das Merkmal als „trifft nicht zu“.</p>
      <table class="tbl"><tr><th>Merkmal</th><th>Daten für</th><th>trifft zu*</th></tr>
        ${(st.features || []).map(f => `<tr><td>${esc(f.label)}<br><span class="muted small">${f.tags.join(', ')}</span></td><td>${f.implicit ? '<span class="muted">– (nur gesetzt, wenn zutreffend)</span>' : `<div class="stack" style="height:8px;width:90px;display:inline-flex"><span style="width:${(f.known * 100).toFixed(1)}%;background:${f.known > 0.5 ? '#2ec27e' : f.known > 0.15 ? '#f5c211' : '#e01b24'}"></span></div> <span class="mono">${pct(f.known)}</span>`}</td><td class="mono">${km(f.km)}</td></tr>`).join('')}
      </table>
      <p class="muted small">* Kilometer gewichtet mit dem Merkmalswert, z. B. zählt ein Abschnitt, der zu 30 % steil ist, mit 30 % seiner Länge.</p>
      <h3>Datenabruf</h3>
      ${load ? kv([
        ['Quelle', load.source === 'Overpass' ? 'öffentliche Overpass-Server (nur Entwicklung)' : `Straßenpakete · ${esc(CONFIG.dataUrl)}`],
        ['Ergebnis', load.failed ? '<span class="bad">fehlgeschlagen</span>' : `<span class="good">ok</span> von ${esc(load.winner)}`],
        ['Dauer', `${fmtMs(load.ms)} in ${load.rounds ?? '–'} Runde(n)`],
        load.bytes ? ['Größe', `${fmtKb(load.bytes)} · ${num(load.elements)} Wege · Lesen ${fmtMs(load.parseMs)}`] : null,
        ['Zeitpunkt', ago(load.at)],
      ]) + `<table class="tbl"><tr><th>Server</th><th>Runde</th><th>Status</th><th>Zeit</th></tr>${load.servers.map(s => `<tr><td>${esc(s.host)}</td><td>${s.round}</td><td class="${s.ok ? 'good' : 'bad'}">${esc(s.status)}</td><td class="mono">${fmtMs(s.ms)}</td></tr>`).join('')}</table>`
        : '<p class="muted">In dieser Sitzung noch nichts geladen (Netz aus gespeicherter Route?).</p>'}`;
  }

  // ---------- Fahrt ----------

  function fahrt() {
    const r = ride.getState();
    if (!r) return '<p class="lead">Keine Fahrt aktiv. Starte eine Fahrt (zum Testen mit „Fahrt simulieren“), dann siehst du hier Live-Daten.</p>';
    const f = r.fix || {};
    const next = r.man.filter(m => !m.done).slice(0, 6);
    return `
      ${kv([
        ['Position', r.pos ? `${r.pos[0].toFixed(5)}, ${r.pos[1].toFixed(5)}` : '–'],
        ['GPS-Genauigkeit', f.acc != null ? `± ${Math.round(f.acc)} m` : '–'],
        ['Tempo', f.speed != null ? `${Math.round(f.speed * 3.6)} km/h` : '–'],
        ['Letzter GPS-Wert', f.t ? ago(f.t) : '–'],
        ['Quelle', r.simTimer ? 'Simulation' : 'GPS'],
        ['Fortschritt', `${km(r.d)} von ${km(r.track.total)} (${pct(r.d / (r.track.total || 1))})`],
        ['Abstand zur Route', r.lastOff != null ? `${Math.round(r.lastOff)} m <span class="muted">(Grenze 50 m, ${r.offCount}/3)</span>` : '–'],
        ['Neuberechnung', r.rerouting ? `<span class="warn">läuft (${r.rerouting === 'off' ? 'verfahren' : 'Befehl'})</span>` : `bereit · bisher ${counters.reroutes}×`],
        ['Ansagen / Befehle', `${counters.announcements} / ${counters.commands} · Stimme ${voiceEnabled() ? 'an' : 'aus'}`],
      ])}
      <h3>Nächste Manöver</h3>
      <table class="tbl"><tr><th>in</th><th>Manöver</th><th>Winkel</th><th>angesagt</th></tr>
        ${next.map(m => `<tr><td class="mono">${km(m.d - r.d)}</td><td>${esc(m.text)}${m.road ? ` <span class="muted">${esc(m.road)}</span>` : ''}${m.silent ? ' <span class="muted">(still)</span>' : ''}</td><td class="mono">${Math.round(m.angle)}°</td><td class="mono">${[...(m.said || [])].join(', ') || '–'}</td></tr>`).join('')}
      </table>
      <h3>Ziele</h3>
      <ol class="top">${r.targets.map((t, i) => `<li class="${i < r.targetIdx ? 'muted' : ''}">${i === r.targetIdx ? '▶ ' : ''}${esc(t.name)} <span class="muted">${t.kind}</span></li>`).join('')}</ol>`;
  }

  // ---------- Profil ----------

  function profil() {
    const { rides, profile, enabled } = prof.state(), D = R.DEFAULTS, P = R.P;
    if (!profile) return '<p class="muted">Profil wird geladen …</p>';
    const a = profile.adj, f2 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
    const rows = [
      ...Object.entries(BAND_GROUPS).map(([g, idx]) => [`Kurven ${{ tight: 'eng', medium: 'mittel', wide: 'weit' }[g]} (Stufe ${idx.map(i => i + 1).join('+')})`,
        `× ${a.band[g].toFixed(2)}`, idx.map(i => `${D.bands[i][1]} → ${P.bands[i][1]}`).join(', ')]),
      ['Kurvenbonus', f2(a.bonus), `${D.bonus} → ${P.bonus}`],
      ...Object.entries(a.weights).map(([k, d]) => [`Gewicht ${FEATURES.find(x => x.key === k)?.label || k}`, f2(d), `${D.weights[k] ?? 0} → ${+(P.weights[k] ?? 0).toFixed(2)}`]),
      ...Object.entries(a.road).map(([c, x]) => [`Faktor ${CLASS_LABEL[c] || c}`, `× ${x.toFixed(2)}`, `${D.roadFactor[c]} → ${P.roadFactor[c]}`]),
    ];
    const band = (r, g) => r.features ? pct(r.features.bands[g] || 0) : '–';
    return `
      <p class="lead">Das persönliche Fahrprofil lernt aus gefahrenen Touren: Schnell-Tags wirken direkt, Sterne über eine gedämpfte Regression je Strecken-Eigenschaft (ab 3 Bewertungen).
        Jüngere Fahrten zählen mehr, alle Anpassungen sind begrenzt. Daten bleiben auf dem Gerät (Ordner rides/ bzw. IndexedDB).</p>
      ${kv([
        ['Status', enabled ? '<span class="good">aktiv</span>' : 'aus (Standardwerte)'],
        ['Fahrten', `${rides.length} gespeichert · ${profile.n} zählen · ${profile.rated} mit Sternen`],
        ['Bewertungen lernen', profile.rated >= 3 ? 'ja' : `ab 3 Bewertungen (noch ${3 - profile.rated})`],
      ])}
      <h3>Anpassungen</h3>
      <table class="tbl"><tr><th>Stellschraube</th><th>gelernt</th><th>Standard → jetzt</th></tr>
        ${rows.map(([k, v, x]) => `<tr><td>${esc(k)}</td><td class="mono">${v}</td><td class="mono">${enabled ? x : '–'}</td></tr>`).join('')}
      </table>
      ${profile.reasons.length ? `<ul class="top">${profile.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="muted">Noch keine nennenswerten Anpassungen.</p>'}
      <h3>Fahrten</h3>
      <table class="tbl"><tr><th>Datum</th><th>km</th><th>★</th><th>eng</th><th>mittel</th><th>weit</th><th>gerade</th><th>Ø Kurve</th><th>Tags</th></tr>
        ${rides.map(r => `<tr class="${r.ignored ? 'muted' : ''}"><td class="mono">${new Date(r.at).toLocaleDateString('de-DE')}${r.sim ? ' sim' : ''}</td><td class="mono">${Math.round(r.km / 1000)}</td><td class="mono">${r.rating || '–'}</td>
          <td class="mono">${band(r, 'tight')}</td><td class="mono">${band(r, 'medium')}</td><td class="mono">${band(r, 'wide')}</td><td class="mono">${band(r, 'straight')}</td>
          <td class="mono">${r.speed?.curvy ? `${Math.round(r.speed.curvy)} km/h` : '–'}</td><td>${esc((r.tags || []).map(t => TAGS.find(x => x.key === t)?.label || t).join(', '))}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Noch keine Fahrten.</td></tr>'}
      </table>`;
  }

  // ---------- Labor ----------

  function labor() {
    const P = R.P, D = R.DEFAULTS;
    const chg = (a, b) => (Math.abs(a - b) > 1e-9 ? ' chg' : '');
    const classes = Object.keys(D.speed);
    return `
      <p class="lead">Parameter live verändern und die Wirkung auf die aktuelle Route vergleichen. Geänderte Werte sind markiert. Nur für diese Sitzung, nichts wird dauerhaft gespeichert.${prof.state().enabled ? ' Die Ausgangswerte enthalten dein persönliches Fahrprofil (Reiter Profil); „Standardwerte“ setzt auch das für diese Sitzung zurück.' : ''}</p>
      <h3>Allgemein</h3>
      <div class="lab">${SCALARS.map(([k, label, step]) => `<label class="${chg(P[k], D[k]).trim()}"><span>${label}</span><input type="number" step="${step}" data-p="${k}" value="${P[k]}"><small>Standard ${D[k]}</small></label>`).join('')}</div>
      <h3>Kurvenradius → Gewicht</h3>
      <div class="lab">${P.bands.map(([r, w], i) => `<label class="${chg(r, D.bands[i]?.[0] ?? -1).trim()}${chg(w, D.bands[i]?.[1] ?? -1)}"><span>Stufe ${i + 1}: Radius unter (m) / Gewicht</span><span class="pair"><input type="number" step="5" data-band="${i}" data-k="0" value="${r}"><input type="number" step="0.05" data-band="${i}" data-k="1" value="${w}"></span></label>`).join('')}</div>
      <h3>Straßenklassen</h3>
      <table class="tbl"><tr><th>Klasse</th><th>Tempo km/h</th><th>Faktor</th></tr>
        ${classes.map(c => `<tr><td>${CLASS_LABEL[c]}</td><td><input type="number" step="5" data-speed="${c}" value="${P.speed[c]}" class="${chg(P.speed[c], D.speed[c]).trim()}"></td><td><input type="number" step="0.05" data-factor="${c}" value="${P.roadFactor[c]}" class="${chg(P.roadFactor[c], D.roadFactor[c]).trim()}"></td></tr>`).join('')}
      </table>
      <h3>Merkmale (Gewichte)</h3>
      <p class="muted small">Kosten × (1 + Gewicht × Merkmal). Positiv = meiden, negativ = bevorzugen, 0 = egal. Neue Merkmale entstehen in src/features.js.</p>
      <div class="lab">${FEATURES.map(f => `<label class="${chg(P.weights[f.key] ?? 0, D.weights[f.key] ?? 0).trim()}"><span>${esc(f.label)}</span><input type="number" step="0.1" min="-0.9" data-w="${f.key}" value="${P.weights[f.key] ?? 0}"><small>Standard ${D.weights[f.key] ?? 0} · OSM-Tags: ${f.tags.join(', ')}</small></label>`).join('')}</div>
      <div class="buttons"><button id="labApply" class="primary">Anwenden und neu berechnen</button><button id="labReset">Standardwerte</button></div>
      <p id="labMsg" class="muted small"></p>
      <h3>Vergleich</h3>
      <table class="tbl"><tr><th>#</th><th>Änderung</th><th>Länge</th><th>kurvig</th><th>Zeit</th><th>Rechnen</th></tr>
        ${labHistory.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.label)}</td><td class="mono">${km(h.len)}</td><td class="mono">${pct(h.curvy)}</td><td class="mono">${Math.round(h.time / 60)} min</td><td class="mono">${fmtMs(h.ms)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Noch keine Läufe. Werte ändern und „Anwenden“ tippen.</td></tr>'}
      </table>`;
  }

  function diffLabel() {
    const P = R.P, D = R.DEFAULTS, out = [];
    for (const [k] of SCALARS) if (P[k] !== D[k]) out.push(`${k} ${P[k]}`);
    if (JSON.stringify(P.bands) !== JSON.stringify(D.bands)) out.push('Radien geändert');
    for (const f of FEATURES) if ((P.weights[f.key] ?? 0) !== (D.weights[f.key] ?? 0)) out.push(`${f.key} ${P.weights[f.key]}`);
    for (const c of Object.keys(D.speed)) {
      if (P.speed[c] !== D.speed[c]) out.push(`Tempo ${c} ${P.speed[c]}`);
      if (P.roadFactor[c] !== D.roadFactor[c]) out.push(`Faktor ${c} ${P.roadFactor[c]}`);
    }
    return out.join(', ') || 'Standard';
  }

  function bindLab() {
    $('labApply').onclick = async () => {
      const P = R.P, before = JSON.stringify([P.step, P.bands]);
      const val = el => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : null; };
      document.querySelectorAll('#boxBody [data-p]').forEach(el => { const v = val(el); if (v != null) P[el.dataset.p] = v; });
      document.querySelectorAll('#boxBody [data-band]').forEach(el => { const v = val(el); if (v != null) P.bands[+el.dataset.band][+el.dataset.k] = v; });
      P.bands.sort((a, b) => a[0] - b[0]);
      document.querySelectorAll('#boxBody [data-speed]').forEach(el => { const v = val(el); if (v != null && v > 0) P.speed[el.dataset.speed] = v; });
      document.querySelectorAll('#boxBody [data-w]').forEach(el => { const v = val(el); if (v != null) P.weights[el.dataset.w] = Math.max(-0.9, v); });
      document.querySelectorAll('#boxBody [data-factor]').forEach(el => { const v = val(el); if (v != null && v > 0) P.roadFactor[el.dataset.factor] = v; });
      P.step = Math.max(5, P.step);
      $('labMsg').textContent = 'Berechne …';
      const rebuild = JSON.stringify([P.step, P.bands]) !== before;
      const ok = await app.labApply(rebuild);
      if (ok && S.result) {
        const r = S.result.route;
        // reine Rechenzeit des Algorithmus (Netz neu vermessen + Routensuche), ohne Bildschirm-Aktualisierung
        const ms = (R.metrics.route?.ms || 0) + (rebuild ? R.metrics.build?.ms || 0 : 0);
        labHistory.push({ label: diffLabel(), len: r.len, curvy: r.curvyLen / (r.len || 1), time: r.time, ms });
      }
      render();
      $('labMsg').textContent = ok ? 'Fertig.' : 'Erst eine Route planen (Start und Ziel setzen).';
    };
    $('labReset').onclick = () => {
      Object.assign(R.P, JSON.parse(JSON.stringify(R.DEFAULTS)));
      render();
      $('labMsg').textContent = 'Standardwerte gesetzt. „Anwenden“ tippen, um neu zu berechnen.';
    };
  }

  // ---------- System ----------

  function system() {
    if (sttOk === null) canListen().then(v => { sttOk = v; });
    if (!storage && navigator.storage?.estimate) navigator.storage.estimate().then(e => { storage = e; }).catch(() => {});
    if (!regions) listRegions().then(r => { regions = r; setTimeout(() => { regions = null; }, 5000); });
    if (cacheCount === null) cacheKeys().then(k => { cacheCount = k.length; setTimeout(() => { cacheCount = null; }, 10000); });
    if (!saved) listRoutes().then(l => { saved = l; setTimeout(() => { saved = null; }, 10000); });
    const svc = Object.entries(services);
    return `
      ${kv([
        ['App', `${pkg.name} ${pkg.version}`],
        ['Plattform', `${Capacitor.getPlatform()}${Capacitor.isNativePlatform() ? ' (nativ)' : ' (Web)'}`],
        ['Bildschirm', `${innerWidth} × ${innerHeight} px · Pixeldichte ${devicePixelRatio}`],
        ['Sprachausgabe', voiceEnabled() ? '<span class="good">an</span>' : 'aus'],
        ['Spracherkennung', sttOk === null ? 'prüfe …' : sttOk ? '<span class="good">verfügbar</span>' : '<span class="bad">nicht verfügbar</span> (Texteingabe)'],
        ['GPS', navigator.geolocation ? 'verfügbar' : '<span class="bad">fehlt</span>'],
        ['Gespeicherte Routen', saved ? `${saved.length}` : '…'],
        ['Speicher belegt', storage ? `${fmtKb(storage.usage)} von ${fmtKb(storage.quota)}` : '–'],
        ['Netz', isOnline() ? '<span class="good">online</span>' : '<span class="warn">offline</span>'],
        ['Kartenquelle', document.querySelector('.leaflet-pane.leaflet-offline-pane canvas') ? 'eigene Offline-Karte' : 'online (OpenStreetMap)'],
        ['Offline-Regionen', regions === null ? '…' : regions.length ? regions.map(r => `${esc(r.name)}${r.complete ? '' : ' <span class="warn">(unvollständig)</span>'}`).join(', ') : '<span class="muted">keine</span>'],
        ['Rechenkern', `${engineInfo.mode}${engineInfo.error ? ` <span class="muted">(${esc(engineInfo.error)})</span>` : ''}`],
        ['Straßen-Cache', cacheCount === null ? '…' : `${cacheCount} Einträge (Kacheln und Umkreise, 30 Tage gültig)`],
        ['Kartenkacheln', `${counters.tilesOk} geladen · ${counters.tilesErr ? `<span class="bad">${counters.tilesErr} Fehler</span>` : '0 Fehler'}`],
      ])}
      <h3>Dienste</h3>
      <table class="tbl"><tr><th>Dienst</th><th>Status</th><th>Antwort</th><th>zuletzt</th></tr>
        ${R.metrics.load ? `<tr><td>Straßendaten</td><td class="${R.metrics.load.failed ? 'bad' : 'good'}">${R.metrics.load.failed ? 'Fehler' : esc(R.metrics.load.winner)}</td><td class="mono">${fmtMs(R.metrics.load.ms)}</td><td>${ago(R.metrics.load.at)}</td></tr>` : ''}
        ${svc.map(([n, s]) => `<tr><td>${esc(n)}</td><td class="${s.ok ? 'good' : 'bad'}">${s.ok ? 'ok' : esc(s.info || 'Fehler')}</td><td class="mono">${fmtMs(s.ms)}</td><td>${ago(s.at)}</td></tr>`).join('')}
        ${!svc.length && !R.metrics.load ? '<tr><td colspan="4" class="muted">Noch keine Netzaufrufe in dieser Sitzung.</td></tr>' : ''}
      </table>
      <div class="buttons"><button id="boxCopy">Diagnose kopieren</button><button id="boxCache">Straßen-Cache leeren</button><button id="boxLock" class="danger">Boxengasse sperren</button></div>
      <textarea id="boxDump" hidden readonly></textarea>`;
  }

  function diagnose() {
    const r = S.result?.route;
    return JSON.stringify({
      app: `${pkg.name} ${pkg.version}`, platform: Capacitor.getPlatform(), at: new Date().toISOString(),
      metrics: R.metrics, services, counters, params: diffLabel(),
      route: r && { mode: S.mode, len: Math.round(r.len), time: Math.round(r.time), curvy: +(r.curvyLen / r.len).toFixed(3), avgCurv: +r.avgCurv.toFixed(3) },
      graph: S.net, engine: engineInfo, events: events.slice(-60),
    }, null, 1);
  }

  // ---------- Log ----------

  function log() {
    const time = t => new Date(t).toLocaleTimeString('de-DE');
    return `<ol class="logl">${[...events].reverse().map(e => `<li><span class="mono muted">${time(e.t)}</span> <span class="tag ${e.kind}">${e.kind}</span> ${esc(e.text)}</li>`).join('') || '<li class="muted">Noch keine Ereignisse.</li>'}</ol>`;
  }

  // ---------- Verdrahtung ----------

  $('boxTabs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tab]');
    if (b) { tab = b.dataset.tab; renderTabs(); render(); }
  });
  $('boxClose').addEventListener('click', close);
  $('boxBtn').addEventListener('click', () => open());
  $('boxBody').addEventListener('click', async ev => {
    if (ev.target.id === 'boxLock') lock();
    if (ev.target.id === 'boxCache') { await cacheClear(); cacheCount = null; app.flash('Straßen-Cache geleert'); render(); }
    if (ev.target.id === 'boxCopy') {
      const text = diagnose();
      try { await navigator.clipboard.writeText(text); app.flash('Diagnose in die Zwischenablage kopiert'); }
      catch { const t = $('boxDump'); t.hidden = false; t.value = text; t.select(); app.flash('Diagnose unten markiert – bitte kopieren'); }
    }
  });
  if (new URLSearchParams(location.search).has('boxengasse')) unlock();
  updateEntry();

  return { tap, open, isUnlocked: boxUnlocked };
}
