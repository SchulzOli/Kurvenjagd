// Fahrmodus: GPS-Verfolgung, Manöver-Anzeige, Sprachansagen, Neuberechnung und Sprachbefehle.
import L from 'leaflet';
import * as R from './router.js';
import { buildTrack, locate, arrowSvg, fmtDist, sayDist, pointAt, bearing } from './nav.js';
import { parseCommand, COMMANDS } from './voice.js';
import { say, listen, canListen, keepAwake, setVoice, voiceEnabled } from './speech.js';
import { log, counters, timed } from './telemetry.js';
import { isOnline } from './net.js';
import { nearbyPois } from './tiles.js';
import { CONFIG } from './config.js';
import { glareNow } from './sun.js';
import { coveredSteps, rideFeatures } from './profile.js';

const $ = id => document.getElementById(id);
const OFF_ROUTE = 50;      // m Abstand zur Route, ab dem man als „verfahren“ gilt
const SIM_STEP = 30;       // m pro Simulationsschritt (alle 0,5 s ≈ 216 km/h, also zügig zum Testen)
const MIN_RIDE = 1000;     // m: kürzere Fahrten werden nicht fürs Fahrprofil aufgezeichnet
const TRACE_STEP = 20;     // m zwischen zwei Punkten der aufgezeichneten Spur
const TRACE_MAX = 6000;    // Punkte; darüber wird ausgedünnt
// Ansage-Stufen in m je Manövertyp
const STAGES = { turn: [500, 150, 40], hairpin: [300, 80], stop: [400, 30], goal: [400, 30] };
const SPEAKER = on => `<svg viewBox="0 0 24 24" fill="none" stroke="${on ? '#f4f4f2' : '#ff6b6b'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/>${on ? '<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>' : '<path d="M17 9l5 6M22 9l-5 6"/>'}</svg>`;
const FLAG = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 44V6"/><path d="M12 8h24l-6 8 6 8H12" fill="currentColor"/></svg>';

const km = m => (m / 1000).toFixed(1).replace('.', ',') + ' km';
const minutes = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, '0')} h` : `${Math.max(1, Math.round(s / 60))} min`;
const sayTime = s => s >= 3600 ? `${Math.floor(s / 3600)} Stunden ${Math.round(s / 60) % 60} Minuten` : `${Math.max(1, Math.round(s / 60))} Minuten`;

// app: Schnittstelle zur Planung (Route berechnen, Punkte übernehmen, Namen …)
export function initRide(map, S, app) {
  let ride = null;
  let toastTimer;

  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000);
  }
  function speak(text) {
    if (ride) ride.lastSay = text;
    (globalThis.__rideLog ||= []).push(text); // Protokoll zum Testen (Konsole: __rideLog)
    counters.announcements++;
    log('ansage', text);
    toast(text);
    say(text);
  }

  // ---------- Start / Ende ----------

  async function start() {
    if (!app.isFresh()) return;
    const res = S.result;
    // Ziele der Reihe nach; bei Rundtouren sind die Wegpunkte stille Zwischenziele
    const targets = res.mode === 'ab'
      ? res.points.slice(1).map((p, i, a) => ({ p, name: app.placeName(p), kind: i === a.length - 1 ? 'goal' : 'stop' }))
      : [...res.waypoints.map(p => ({ p, name: 'Wegpunkt', kind: 'via' })), { p: res.points[0], name: 'Start', kind: 'goal' }];
    ride = { targets, follow: true, offCount: 0, d: 0, simD: 0, pos: res.points[0], lastSay: '' };
    // Aufzeichnung fürs Fahrprofil: gefahrene Abschnitte, GPS-Spur, Tempo in Kurven und auf Geraden
    ride.rec = { at: Date.now(), sim: $('sim').checked, steps: [], trace: [], speed: { curvy: [0, 0], straight: [0, 0] },
      planned: { len: res.route.len, curvy: res.route.curvyLen / (res.route.len || 1), mode: res.mode, curvySetting: app.curvy?.() },
      name: res.mode === 'ab' ? `${app.placeName(res.points[0]).split(',')[0]} → ${targets[targets.length - 1].name.split(',')[0]}` : `Rundtour ab ${app.placeName(res.points[0]).split(',')[0]}` };
    setRoute(res);

    document.body.dataset.view = 'ride';
    ride.marker = L.marker(ride.pos, { icon: L.divIcon({ className: '', html: '<div class="posdot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    map.setView(ride.pos, 16);
    keepAwake(true);
    speak(`Los geht's. ${sayDist(res.route.len).replace('Metern', 'Meter').replace('Kilometern', 'Kilometer')}, etwa ${sayTime(res.route.time)}.`);
    // wichtigste Wetter-Warnungen der Planung gleich zu Beginn
    const warn = (S.cond?.warnings || []).filter(w => ['storm', 'rain', 'wind', 'cold', 'hot', 'dark'].includes(w.kind)).slice(0, 2);
    if (warn.length) speak('Achtung: ' + warn.map(w => w.text.replace(/km (\d+)/g, 'Kilometer $1')).join('. '));

    if ($('sim').checked) {
      ride.simTimer = setInterval(() => {
        ride.simD = Math.min(ride.track.total, ride.simD + SIM_STEP);
        onPos(pointAt(ride.track, ride.simD), 5, SIM_STEP * 2);
      }, 500);
    } else if (navigator.geolocation) {
      ride.watch = navigator.geolocation.watchPosition(
        p => onPos([p.coords.latitude, p.coords.longitude], p.coords.accuracy, p.coords.speed),
        err => toast('GPS: ' + err.message),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    } else toast('Kein GPS verfügbar – aktiviere „Fahrt simulieren“ zum Testen');
    ride.voiceOk = await canListen();
    render();
  }

  function stop(msg) {
    if (!ride) return;
    flushSteps();
    const rec = finishRecording();
    clearInterval(ride.simTimer);
    if (ride.watch != null) navigator.geolocation.clearWatch(ride.watch);
    ride.marker.remove();
    keepAwake(false);
    if (msg) say(msg);
    ride = null;
    hidePanels();
    document.body.dataset.view = 'plan';
    app.afterRide(rec);
  }

  // Gefahrenen Teil der aktuellen Route übernehmen (vor jeder Neuberechnung und am Ende)
  function flushSteps() {
    if (!ride?.route || ride.flushed === ride.route) return;
    ride.rec.steps.push(...coveredSteps(ride.route.steps, ride.d));
    ride.flushed = ride.route;
  }

  // Ergebnis der Aufzeichnung oder null (zu kurz)
  function finishRecording() {
    const r = ride.rec, len = r.steps.reduce((a, s) => a + s.len, 0);
    if (len < MIN_RIDE) { log('profil', `Fahrt nicht aufgezeichnet (nur ${Math.round(len)} m auf der Route)`); return null; }
    const avg = ([sum, n]) => (n ? sum / n * 3.6 : null);
    const out = { at: r.at, end: Date.now(), sim: r.sim, name: r.name, planned: r.planned, km: len, trace: r.trace,
      features: rideFeatures(r.steps, R.bendMeters),
      speed: { curvy: avg(r.speed.curvy), straight: avg(r.speed.straight) } };
    log('profil', `Fahrt aufgezeichnet: ${km(len)}, ${r.trace.length} Spurpunkte`);
    return out;
  }

  // Spurpunkt und Tempo merken (nur auf der Route, Tempo nur in Bewegung)
  function record(pos, speed) {
    const r = ride.rec, last = r.trace[r.trace.length - 1];
    if (!last || R.haversine(pos, last) >= TRACE_STEP) {
      r.trace.push([+pos[0].toFixed(5), +pos[1].toFixed(5), Math.round((Date.now() - r.at) / 1000)]);
      if (r.trace.length > TRACE_MAX) r.trace = r.trace.filter((_, i) => i % 2 === 0);
    }
    if (speed == null || speed < 2) return;
    while (ride.stepIdx < ride.stepEnd.length - 1 && ride.stepEnd[ride.stepIdx] < ride.d) ride.stepIdx++;
    const step = ride.route.steps[ride.stepIdx];
    if (!step) return;
    const bucket = r.speed[step.curv >= R.P.curveMin ? 'curvy' : 'straight'];
    bucket[0] += speed; bucket[1]++;
  }

  // result: Ergebnis des Rechenkerns (Route + vorberechnete Manöver)
  function setRoute(result) {
    const route = result.route, track = buildTrack(route.coords);
    const list = result.maneuvers.map(m => ({ ...m })); // eigene Kopie: done/said werden hier gesetzt
    // Ankunft an Rundtour-Wegpunkten nicht ansagen; Stopps mit Namen ansagen
    for (const m of list) {
      const t = ride.targets[m.stop - 1];
      if (m.kind === 'stop' && t?.kind === 'via') m.silent = true;
      if (m.kind === 'stop' && t) { m.text = `Stopp: ${t.name}`; m.say = `Zwischenstopp ${t.name} erreicht`; }
      if (m.kind === 'goal' && t) m.text = `Ziel: ${t.name}`;
      m.said = new Set();
    }
    flushSteps(); // gefahrenen Teil der bisherigen Route merken
    let x = 0;
    const stepEnd = route.steps.map(s => (x += s.len));
    Object.assign(ride, { route, man: list, track, d: 0, targetIdx: 0, stepEnd, stepIdx: 0 });
  }

  // ---------- Position ----------

  function onPos(pos, accuracy = 20, speed = null) {
    if (!ride) return;
    ride.pos = pos;
    ride.fix = { acc: accuracy, speed, t: Date.now() };
    ride.marker.setLatLng(pos);
    if (ride.follow) map.panTo(pos, { animate: true, duration: 0.4 });
    // Beim Verfahren gibt es keine sinnvolle alte Route; bei Sprachbefehlen wird auf ihr weitergeführt
    if (ride.rerouting === 'off') return render();

    const loc = locate(ride.track, pos, ride.d);
    ride.lastOff = loc.off;
    if (!ride.rerouting && loc.off > OFF_ROUTE && accuracy < OFF_ROUTE) {
      // Nach einer Neuberechnung erst wieder prüfen, wenn man sich bewegt hat und etwas Zeit vergangen ist –
      // sonst entsteht abseits jeder Straße (Parkplatz, Feldweg) eine Endlosschleife
      const last = ride.lastReroute;
      if (last && (R.haversine(pos, last.pos) < 150 || Date.now() - last.t < 30000)) return render();
      if (++ride.offCount >= 3) reroute('Du bist von der Route abgekommen. Route wird neu berechnet.', undefined, 'off');
      return;
    }
    ride.offCount = 0;
    ride.d = loc.d;
    record(pos, speed);
    announce();
    checkGlare(pos);
    render();
  }

  // Blendet die tief stehende Sonne gerade in Fahrtrichtung? Höchstens alle 10 Minuten ansagen.
  function checkGlare(pos) {
    const now = Date.now();
    if (now - (ride.glareCheck || 0) < 20e3) return;
    ride.glareCheck = now;
    const heading = bearing(pointAt(ride.track, ride.d), pointAt(ride.track, ride.d + 150));
    if (glareNow(now, pos, heading) && now - (ride.glareSaid || 0) > 10 * 60e3) {
      ride.glareSaid = now;
      speak('Achtung, tief stehende Sonne von vorn.');
    }
  }

  function announce() {
    const d = ride.d;
    for (const m of ride.man) {
      if (m.done) continue;
      const dist = m.d - d;
      if (m.kind === 'stop' || m.kind === 'goal') {
        if (dist < 30) { // angekommen
          m.done = true;
          ride.targetIdx = m.stop;
          if (!m.silent) speak(m.kind === 'goal' ? 'Ziel erreicht. Navigation beendet.' : m.say);
          if (m.kind === 'goal') { setTimeout(() => stop(), 3000); return; }
          continue;
        }
      } else if (dist < -15) { m.done = true; continue; }
      if (m.silent) continue;
      // nächstes Manöver: höchstens eine Ansage pro Positionsupdate
      const stages = STAGES[m.kind], last = stages[stages.length - 1];
      let th = [...stages].reverse().find(x => dist <= x);       // engste Stufe, in der wir sind
      if (th === undefined || m.said.has(th)) return;
      if (th !== last && dist <= last * 1.5) th = last;           // schon sehr nah: gleich „Jetzt“
      stages.filter(x => x >= th).forEach(x => m.said.add(x));   // weiter entfernte Stufen nicht nachholen
      // Vorankündigung nur, wenn seit der letzten genug Strecke vergangen ist
      if (th !== last && m.lastDist !== undefined && m.lastDist - dist < th * 0.6) return;
      m.lastDist = dist;
      if (m.kind === 'stop' || m.kind === 'goal') {
        if (th !== last) speak(`In ${sayDist(dist)} ${m.kind === 'goal' ? 'erreichst du dein Ziel' : `kommt der Zwischenstopp ${ride.targets[m.stop - 1]?.name || ''}`}`);
      } else speak(th === last ? `Jetzt ${m.say}` : `In ${sayDist(dist)} ${m.say}`);
      return;
    }
  }

  // ---------- Anzeige ----------

  const iconFor = m => m.kind === 'stop' || m.kind === 'goal' ? FLAG
    : arrowSvg(m.kind === 'hairpin' ? Math.sign(m.angle) * 165 : m.angle);

  function render() {
    if (!ride) return;
    const next = ride.man.filter(m => !m.done && !m.silent);
    const m = next[0];
    if (m) {
      $('manArrow').innerHTML = iconFor(m);
      $('manDist').textContent = fmtDist(m.d - ride.d);
      $('manText').textContent = m.text + (m.road ? ` · ${m.road}` : '');
    }
    $('manNext').innerHTML = next.slice(1, 3).map(n => `<span>${iconFor(n)}${fmtDist(n.d - ride.d)}</span>`).join('');
    const rest = ride.track.total - ride.d;
    const stopM = next.find(n => n.kind === 'stop');
    const time = ride.route.time * rest / (ride.track.total || 1);
    $('rideInfo').textContent = (ride.rerouting ? 'Neue Route wird berechnet … · ' : '') + `${km(rest)} · ${minutes(time)}` + (stopM ? ` · ${ride.targets[stopM.stop - 1]?.name.split(',')[0]} in ${fmtDist(stopM.d - ride.d)}` : '');
  }

  function statusText() {
    const rest = ride.track.total - ride.d, time = ride.route.time * rest / (ride.track.total || 1);
    const stopM = ride.man.find(m => !m.done && !m.silent && m.kind === 'stop');
    const goal = `Ziel in ${sayDist(rest)}, etwa ${sayTime(time)}.`;
    if (!stopM) return `Kein Zwischenstopp mehr. ${goal}`;
    const ds = stopM.d - ride.d, ts = ride.route.time * ds / ride.track.total;
    return `Nächster Halt: ${ride.targets[stopM.stop - 1].name} in ${sayDist(ds)}, etwa ${sayTime(ts)}. ${goal}`;
  }

  // ---------- Neuberechnung ----------

  // kind 'off' = verfahren (alte Route ungültig), sonst Änderung per Befehl (alte Route gilt bis dahin weiter)
  async function reroute(msg, targets = ride.targets.slice(ride.targetIdx), kind = 'cmd') {
    if (!ride || ride.rerouting) return;
    ride.rerouting = kind;
    counters.reroutes++;
    log('neu', msg || 'Neuberechnung');
    ride.lastReroute = { pos: ride.pos, t: Date.now() };
    render();
    if (msg) speak(msg);
    try {
      const result = await app.calcRoute([ride.pos, ...targets.map(t => t.p)]);
      if (!ride) return;
      ride.targets = targets;
      setRoute(result);
      // inzwischen weitergefahren: Position auf der neuen Route bestimmen
      ride.d = ride.simD = locate(ride.track, ride.pos, 0).d;
      app.applyRideRoute(result, targets);
      render();
    } catch (err) {
      speak('Neuberechnung fehlgeschlagen. ' + (err.message || ''));
    } finally {
      if (ride) { ride.rerouting = false; ride.offCount = 0; }
    }
  }

  // Neues Ziel an der Stelle einfügen, wo es den kleinsten Umweg macht (nie hinter das Ziel)
  function insertTarget(t, asNext) {
    const rest = ride.targets.slice(ride.targetIdx);
    let at = 0;
    if (!asNext) {
      const seq = [ride.pos, ...rest.map(x => x.p)];
      let best = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const c = R.haversine(seq[i], t.p) + R.haversine(t.p, seq[i + 1]) - R.haversine(seq[i], seq[i + 1]);
        if (c < best) { best = c; at = i; }
      }
    }
    rest.splice(at, 0, t);
    return rest;
  }

  // ---------- Befehle ----------

  // Tankstellen und Rasten aus den Straßenpaketen (auch offline, soweit die Kacheln im Cache liegen);
  // nur ohne Pakete beim Entwickeln über Overpass
  async function poiCandidates(kind) {
    const found = await nearbyPois(ride.pos, kind === 'fuel' ? 'f' : 'r');
    if (found) return found;
    if (!CONFIG.overpassFallback) return [];
    const [lat, lon] = ride.pos;
    const filter = kind === 'fuel' ? '["amenity"="fuel"]' : '["amenity"~"^(cafe|restaurant|biergarten|fast_food)$"]';
    const data = await timed('Overpass (Orte)', R.overpass(`[out:json][timeout:25];(node${filter}(around:8000,${lat},${lon});way${filter}(around:8000,${lat},${lon}););out center 40;`, undefined, { record: false }));
    return data.elements.map(el => ({ p: el.type === 'node' ? [el.lat, el.lon] : el.center && [el.center.lat, el.center.lon],
      name: el.tags?.name || el.tags?.brand || '', city: el.tags?.['addr:city'] || '' })).filter(c => c.p);
  }

  async function findPoi(kind) {
    const heading = bearing(pointAt(ride.track, ride.d), pointAt(ride.track, ride.d + 200));
    let best = null;
    for (const c of await poiCandidates(kind)) {
      const behind = Math.abs(((bearing(ride.pos, c.p) - heading + 540) % 360) - 180) > 100;
      const score = R.haversine(ride.pos, c.p) + (behind ? 4000 : 0);
      if (!best || score < best.score) best = { ...c, score };
    }
    if (!best) return null;
    const label = kind === 'fuel' ? 'Tankstelle' : 'Rast';
    return { p: best.p, kind: 'stop', name: [best.name || label, best.city].filter(Boolean).join(', ') };
  }

  async function geocode(place) {
    const [lat, lon] = ride.pos;
    const res = await timed('Photon', fetch(`${CONFIG.geocoderUrl}api/?limit=1&lang=de&lat=${lat}&lon=${lon}&q=${encodeURIComponent(place)}`));
    const f = (await res.json()).features?.[0];
    if (!f) return null;
    const [plon, plat] = f.geometry.coordinates, pr = f.properties;
    if (R.haversine(ride.pos, [plat, plon]) > 150000) return null;
    return { p: [plat, plon], kind: 'stop', name: [pr.name, pr.city || pr.county].filter((v, i, a) => v && a.indexOf(v) === i).join(', ') };
  }

  async function handle(text) {
    if (!ride) return;
    const cmd = parseCommand(text);
    counters.commands++;
    log('befehl', `„${text}“ → ${cmd.type}`);
    try {
      switch (cmd.type) {
        case 'help':
          showVoice('Du kannst sagen:', true);
          say('Du kannst sagen: Zwischenstopp in Ort, Tankstelle, Pause, nächster Halt, Halt überspringen, kurviger, weniger kurvig, wiederholen oder Navigation beenden.');
          return;
        case 'end': return stop('Navigation beendet.');
        case 'box': return app.openBox('fahrt');
        case 'repeat': return say(ride.lastSay || 'Noch keine Ansage.');
        case 'status': return speak(statusText());
        case 'skip': {
          const rest = ride.targets.slice(ride.targetIdx);
          const i = rest.findIndex(t => t.kind === 'stop');
          if (i < 0) return speak('Kein Zwischenstopp mehr vor dem Ziel.');
          const [gone] = rest.splice(i, 1);
          return reroute(`${gone.name} wird übersprungen. Route wird neu berechnet.`, rest);
        }
        case 'curvy': {
          const v = app.setCurvy(cmd.delta);
          return reroute(`Kurvenlust ${Math.round(v * 100)} Prozent. Route wird neu berechnet.`);
        }
        case 'poi': {
          speak(cmd.poi === 'fuel' ? 'Suche Tankstelle …' : 'Suche Rastmöglichkeit …');
          const t = await findPoi(cmd.poi);
          if (!t) return speak('In der Nähe nichts gefunden.');
          app.setName(t.p, t.name);
          return reroute(`${t.name} in ${sayDist(R.haversine(ride.pos, t.p))} wird als nächster Halt angefahren.`, insertTarget(t, true));
        }
        case 'addPlace': {
          if (!isOnline()) return speak('Ohne Internet kann ich keine Orte suchen.');
          const t = await geocode(cmd.place);
          if (!t) return speak(`${cmd.place} habe ich nicht gefunden.`);
          app.setName(t.p, t.name);
          return reroute(`Zwischenstopp ${t.name} hinzugefügt. Route wird neu berechnet.`, insertTarget(t, false));
        }
        default:
          return speak('Das habe ich nicht verstanden. Sag „Hilfe“ für alle Befehle.');
      }
    } catch (err) {
      speak('Das hat nicht geklappt: ' + err.message);
    }
  }

  // ---------- Sprach-Panel & Schnellmenü ----------

  function hidePanels() { $('voice').hidden = true; $('quick').hidden = true; }
  function showVoice(state, typing) {
    $('quick').hidden = true;
    $('voice').hidden = false;
    $('voiceState').textContent = state;
    $('voiceForm').hidden = !typing;
    $('voiceHelp').innerHTML = typing ? COMMANDS.map(c => `<li>${c}</li>`).join('') : '';
    if (typing) setTimeout(() => $('voiceText').focus(), 50);
  }

  async function onMic() {
    if (!ride) return;
    if (!$('voice').hidden) return hidePanels();
    if (!ride.voiceOk) return showVoice('Spracheingabe hier nicht verfügbar. Befehl eintippen:', true);
    showVoice('Ich höre zu …', false);
    $('mic').classList.add('listening');
    try {
      const text = await listen();
      hidePanels();
      if (text) { toast(`„${text}“`); await handle(text); } else toast('Nichts verstanden');
    } catch {
      showVoice('Spracheingabe nicht möglich. Befehl eintippen:', true);
    } finally {
      $('mic').classList.remove('listening');
    }
  }

  // ---------- Verdrahtung ----------

  // Sprachansagen an/aus – auch während der Fahrt, synchron mit dem Schalter in der Planung
  function renderVoiceBtn() {
    $('rideVoice').innerHTML = SPEAKER(voiceEnabled());
    $('rideVoice').classList.toggle('off', !voiceEnabled());
    $('voiceOn').checked = voiceEnabled();
  }
  $('rideVoice').addEventListener('click', () => {
    setVoice(!voiceEnabled());
    renderVoiceBtn();
    toast(voiceEnabled() ? 'Sprachansagen an' : 'Sprachansagen aus');
  });
  $('voiceOn').addEventListener('change', () => { setVoice($('voiceOn').checked); renderVoiceBtn(); });
  renderVoiceBtn();

  $('ride').addEventListener('click', start);
  $('rideStop').addEventListener('click', () => stop('Navigation beendet.'));
  $('mic').addEventListener('click', onMic);
  $('ridePlus').addEventListener('click', () => { $('voice').hidden = true; $('quick').hidden = !$('quick').hidden; });
  $('quick').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-cmd]');
    if (b) { hidePanels(); handle(b.dataset.cmd); }
  });
  $('voiceForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const text = $('voiceText').value.trim();
    $('voiceText').value = '';
    $('voiceText').blur();
    hidePanels();
    if (text) handle(text);
  });
  map.on('dragstart', () => { if (ride) { ride.follow = false; $('recenter').hidden = false; } });
  $('recenter').addEventListener('click', () => {
    if (!ride) return;
    ride.follow = true;
    $('recenter').hidden = true;
    map.setView(ride.pos, Math.max(map.getZoom(), 16));
  });

  return { isRiding: () => !!ride, handle, getState: () => ride };
}
