// Navigation entlang einer berechneten Route: Manöver ableiten, GPS-Position zuordnen.
// Reine Funktionen ohne UI, damit sie in Node testbar sind.
import { haversine } from './router.js';

const D2R = Math.PI / 180;
const TURN_MIN = 25;      // ab diesem Abbiegewinkel (°) an einer Kreuzung wird angesagt
const HAIRPIN_MIN = 120;  // Richtungsänderung (°) innerhalb von 60 m = Spitzkehre

// Route als Polyline mit kumulierter Distanz je Punkt
export function buildTrack(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] };
}

export function pointAt(track, d) {
  const { coords, cum } = track;
  if (d <= 0) return coords[0];
  if (d >= track.total) return coords[coords.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}

export function bearing([lat1, lon1], [lat2, lon2]) {
  const y = Math.sin((lon2 - lon1) * D2R) * Math.cos(lat2 * D2R);
  const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon2 - lon1) * D2R);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

// Winkel von a nach b in -180..180, positiv = rechts
const turn = (a, b) => ((b - a + 540) % 360) - 180;
const headingAt = (track, d, span) => bearing(pointAt(track, d), pointAt(track, d + span));

function turnWords(angle) {
  const side = angle > 0 ? 'rechts' : 'links', a = Math.abs(angle);
  if (a < 60) return { short: `leicht ${side}`, say: `leicht ${side} halten` };
  if (a < 130) return { short: `${side} abbiegen`, say: `${side} abbiegen` };
  return { short: `scharf ${side}`, say: `scharf ${side} abbiegen` };
}

// Anzahl Straßen an einem Knoten (ungerichtet), um echte Kreuzungen zu erkennen
function degrees(g) {
  const deg = new Uint16Array(g.lat.length);
  for (const e of g.edges) if (!e.dead) { deg[e.a]++; deg[e.b]++; }
  return deg;
}

// Manöver entlang der Route: Abbiegen an Kreuzungen, Spitzkehren, Ankunft an Stopps/Ziel.
// Ergebnis sortiert nach Distanz d (m ab Start).
export function maneuvers(g, route) {
  const track = buildTrack(route.coords), deg = degrees(g);
  const list = [];

  // Abbiegen: an jedem Übergang zwischen zwei Kanten, wenn dort eine Kreuzung ist
  for (let k = 1; k < route.steps.length; k++) {
    const { e, rev } = route.steps[k], ed = g.edges[e];
    const v = rev ? ed.b : ed.a;
    if (deg[v] < 3) continue;
    const d = track.cum[route.stepAt[k]];
    let angle = turn(headingAt(track, d - 25, 25), headingAt(track, d, 25));
    const road = ed.name, prevRoad = g.edges[route.steps[k - 1].e].name;
    // leichter Knick, aber man bleibt auf derselben Straße: nichts ansagen
    if (Math.abs(angle) < TURN_MIN || (Math.abs(angle) < 60 && road && road === prevRoad)) continue;
    // getrennte Fahrbahnen: zwei Knoten kurz hintereinander = ein Manöver
    const last = list[list.length - 1];
    if (last && d - last.d < 40) { angle = Math.max(-179, Math.min(179, last.angle + angle)); list.pop(); }
    const w = turnWords(angle);
    list.push({ d: last && d - last.d < 40 ? last.d : d, kind: 'turn', angle, road, text: w.short, say: w.say + (road ? ` auf ${road}` : '') });
  }

  // Spitzkehren innerhalb von Straßen (nicht direkt an einer Kreuzung)
  for (let d = 30; d < track.total - 30; d += 10) {
    const angle = turn(headingAt(track, d - 30, 15), headingAt(track, d + 15, 15));
    if (Math.abs(angle) < HAIRPIN_MIN || list.some(m => Math.abs(m.d - d) < 60)) continue;
    const side = angle > 0 ? 'rechts' : 'links';
    list.push({ d, kind: 'hairpin', angle, text: `Spitzkehre ${side}`, say: `Spitzkehre ${side}` });
    d += 150; // eine Kehre nur einmal melden
  }

  // Ankunft an Zwischenstopps und Ziel
  const ends = route.steps.legEnds || [route.steps.length];
  ends.forEach((k, i) => {
    const d = k >= route.steps.length ? track.total : track.cum[route.stepAt[k]];
    const goal = i === ends.length - 1;
    list.push({ d, kind: goal ? 'goal' : 'stop', stop: i + 1, angle: 0,
      text: goal ? 'Ziel' : `Stopp ${i + 1}`, say: goal ? 'Ziel erreicht' : `Zwischenstopp ${i + 1} erreicht` });
  });

  return { track, list: list.sort((a, b) => a.d - b.d) };
}

// GPS-Position auf die Route projizieren. hint = letzte bekannte Distanz (sucht zuerst in deren Nähe).
// Ergebnis: d = Distanz ab Start, off = Abstand zur Route in m.
export function locate(track, [lat, lon], hint = 0) {
  const kx = Math.cos(lat * D2R) * 111320, ky = 110540;
  const { coords, cum } = track;
  const scan = (from, to) => {
    let best = { d: 0, off: Infinity };
    for (let i = Math.max(1, from); i <= Math.min(coords.length - 1, to); i++) {
      const [ay, ax] = coords[i - 1], [by, bx] = coords[i];
      const x1 = (ax - lon) * kx, y1 = (ay - lat) * ky, dx = (bx - ax) * kx, dy = (by - ay) * ky;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / l2)) : 0;
      const off = Math.hypot(x1 + t * dx, y1 + t * dy);
      if (off < best.off) best = { d: cum[i - 1] + t * (cum[i] - cum[i - 1]), off };
    }
    return best;
  };
  // Fenster um die letzte Position (-200 m … +2 km), sonst ganze Route
  const idx = dd => { let i = 0; while (i < cum.length - 1 && cum[i] < dd) i++; return i; };
  const near = scan(idx(hint - 200), idx(hint + 2000));
  return near.off < 60 ? near : scan(1, coords.length - 1);
}

// Pfeil-Symbol (SVG) für einen Abbiegewinkel; 0 = geradeaus
export function arrowSvg(angle, color = 'currentColor') {
  const a = Math.max(-170, Math.min(170, angle)) * D2R;
  const x = 24 + Math.sin(a) * 16, y = 24 - Math.cos(a) * 16;
  const h = (da) => [x - Math.sin(a + da) * 9, y + Math.cos(a + da) * 9];
  const [l, r] = [h(-0.6), h(0.6)];
  return `<svg viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 46 V24 L${x.toFixed(1)} ${y.toFixed(1)}"/><path d="M${l[0].toFixed(1)} ${l[1].toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${r[0].toFixed(1)} ${r[1].toFixed(1)}"/></svg>`;
}

export const fmtDist = m => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',')} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`;
export const sayDist = m => m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',').replace(',0', '')} Kilometern` : `${Math.round(m / 50) * 50 || 50} Metern`;
