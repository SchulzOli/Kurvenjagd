// Persönliches Fahrprofil: lernt aus gefahrenen Touren und deinen Bewertungen, welche Strecken dir
// gefallen, und passt die Gewichte des Algorithmus vorsichtig an. Alles bleibt auf dem Gerät.
//
// Zwei Signale:
//  1. Schnell-Tags nach der Fahrt („Mehr Kurven“, „Zu holprig“ …) – wirken direkt, jüngere Fahrten stärker.
//  2. Sterne-Bewertungen – ab 3 bewerteten Fahrten: Welche Strecken-Eigenschaften gehen mit guten
//     Bewertungen einher? (gewichtete, gedämpfte Regression je Eigenschaft)
// Alle Anpassungen sind begrenzt und als Klartext begründet.
import { FEATURES } from './features.js';

// Schnell-Tags und ihre direkte Wirkung
export const TAGS = [
  { key: 'moreCurves', label: 'Mehr Kurven', delta: { tight: 0.12, medium: 0.12, bonus: 0.03 } },
  { key: 'lessCurves', label: 'Weniger Kurven', delta: { tight: -0.12, medium: -0.1, bonus: -0.06 } },
  { key: 'hairpins', label: 'Spitzkehren super', delta: { tight: 0.2 } },
  { key: 'flowing', label: 'Lieber flotte Bögen', delta: { tight: -0.15, wide: 0.25 } },
  { key: 'urban', label: 'Zu viel Ortsdurchfahrt', delta: { w: { slow: 0.3 } } },
  { key: 'rough', label: 'Zu holprig', delta: { w: { rough: 0.4, cobble: 0.3 } } },
  { key: 'steep', label: 'Zu steil', delta: { w: { steep: 0.4 } } },
  { key: 'narrow', label: 'Zu eng', delta: { w: { narrow: 0.4 } } },
  { key: 'mountains', label: 'Mehr Berge', delta: { w: { hilly: -0.3 } } },
];

// Kurvenarten über die Radius-Stufen (Index wie P.bands): eng < 60 m, mittel 60–175 m, weit 175–300 m
export const BAND_GROUPS = { tight: [0, 1], medium: [2, 3], wide: [4] };
const CLASSES = ['primary', 'secondary', 'tertiary', 'unclassified'];
const LIMIT = { bonus: [-0.2, 0.1], weight: [-0.8, 3], road: [0.7, 1.4] };
// Spielraum je Kurvenart: Weite Bögen zählen standardmäßig kaum (Gewicht 0,12) – wer sie mag,
// braucht viel mehr Hub als bei Kehren (Gewicht 1, schon fast gesättigt). Deltas werden damit skaliert.
const BAND_LIMIT = { tight: [0.5, 1.25], medium: [0.6, 2], wide: [0.6, 4] };
const BAND_SCALE = { tight: 1, medium: 1.5, wide: 3 };
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// Gefahrene Kanten (Kanten-Infos mit geom, len, hw, f) bis zur Distanz d (Rest anteilig)
export function coveredSteps(steps, d) {
  const out = [];
  let x = 0;
  for (const s of steps) {
    if (x >= d) break;
    const part = Math.min(1, (d - x) / (s.len || 1));
    out.push(part >= 1 ? s : { ...s, len: s.len * part, part });
    x += s.len;
  }
  return out;
}

// Eigenschaften einer gefahrenen Strecke als Anteile (0..1). bendMeters: Funktion aus router.js.
export function rideFeatures(steps, bendMeters) {
  const km = steps.reduce((a, s) => a + s.len, 0) || 1;
  const bands = { tight: 0, medium: 0, wide: 0, straight: 0 }, feat = {}, cls = {};
  let curvSum = 0;
  for (const s of steps) {
    const m = bendMeters(s.geom), sum = m.reduce((a, b) => a + b, 0) || 1, f = s.len / sum; // auf gefahrene Länge skalieren
    for (const [g, idx] of Object.entries(BAND_GROUPS)) bands[g] += idx.reduce((a, i) => a + (m[i] || 0), 0) * f;
    bands.straight += (m[m.length - 1] || 0) * f;
    for (const [k, v] of Object.entries(s.f || {})) feat[k] = (feat[k] || 0) + v * s.len;
    const c = s.hw.replace(/_link$/, '');
    cls[c] = (cls[c] || 0) + s.len;
    curvSum += s.curv * s.len;
  }
  const share = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / km]));
  return { km, bands: share(bands), feat: share(feat), cls: share(cls), avgCurv: curvSum / km };
}

// Eigenschaften, die gelernt werden, mit Zugriff auf den Wert einer Fahrt
const DIMS = [
  ...Object.keys(BAND_GROUPS).map(g => ({ key: `band:${g}`, get: x => x.bands[g] || 0 })),
  ...FEATURES.map(f => ({ key: `w:${f.key}`, get: x => x.feat[f.key] || 0 })),
  ...CLASSES.map(c => ({ key: `cls:${c}`, get: x => x.cls[c] || 0 })),
];

// rides: [{ rating (1–5 oder null), tags: [...], features, at }] – neueste zuerst
export function learn(rides) {
  const adj = { band: { tight: 0, medium: 0, wide: 0 }, bonus: 0, weights: {}, road: {} };
  const why = new Map(); // Anpassung -> Gründe
  const note = (key, text) => { if (!why.has(key)) why.set(key, new Set()); why.get(key).add(text); };

  // 1) Tags: direkte Wirkung, jüngere Fahrten zählen mehr
  rides.forEach((r, age) => {
    const w = 0.85 ** age;
    for (const t of r.tags || []) {
      const def = TAGS.find(x => x.key === t);
      if (!def) continue;
      for (const g of ['tight', 'medium', 'wide']) if (def.delta[g]) { adj.band[g] += def.delta[g] * BAND_SCALE[g] * w; note(`band:${g}`, `„${def.label}“`); }
      if (def.delta.bonus) { adj.bonus += def.delta.bonus * w; note('bonus', `„${def.label}“`); }
      for (const [k, v] of Object.entries(def.delta.w || {})) { adj.weights[k] = (adj.weights[k] || 0) + v * w; note(`w:${k}`, `„${def.label}“`); }
    }
  });

  // 2) Bewertungen: gewichtete Regression je Eigenschaft (mit Dämpfung), erst ab 3 bewerteten Fahrten
  const rated = rides.map((r, age) => ({ ...r, w: 0.9 ** age })).filter(r => r.rating && r.features);
  if (rated.length >= 3) {
    const W = rated.reduce((a, r) => a + r.w, 0), rMean = rated.reduce((a, r) => a + r.w * r.rating, 0) / W;
    const shrink = rated.length / (rated.length + 4); // wenige Fahrten -> vorsichtig
    for (const dim of DIMS) {
      const xs = rated.map(r => dim.get(r.features)), xMean = rated.reduce((a, r, i) => a + r.w * xs[i], 0) / W;
      let cov = 0, vari = 0;
      rated.forEach((r, i) => { cov += r.w * (r.rating - rMean) * (xs[i] - xMean); vari += r.w * (xs[i] - xMean) ** 2; });
      if (vari / W < 1e-4) continue; // Eigenschaft kommt kaum vor oder ändert sich nicht
      const beta = cov / (vari + 0.02 * W) * shrink; // Sterne je Anteil (gedämpft)
      const effect = clamp(beta * 0.06, [-0.4, 0.4]); // ≈ 0,3 bei klarer Vorliebe
      if (Math.abs(effect) < 0.03) continue;
      const [kind, name] = dim.key.split(':');
      const text = effect > 0 ? 'gut bewertete Touren hatten mehr davon' : 'gut bewertete Touren hatten weniger davon';
      if (kind === 'band') adj.band[name] += effect * BAND_SCALE[name];
      else if (kind === 'w') adj.weights[name] = (adj.weights[name] || 0) - effect * 2; // mögen -> negatives Gewicht
      else adj.road[name] = (adj.road[name] || 0) - effect;                         // mögen -> günstiger
      note(dim.key, text);
    }
  }

  // Grenzen
  for (const g of Object.keys(adj.band)) adj.band[g] = clamp(1 + adj.band[g], BAND_LIMIT[g]);
  adj.bonus = clamp(adj.bonus, LIMIT.bonus);
  for (const k of Object.keys(adj.weights)) adj.weights[k] = clamp(adj.weights[k], LIMIT.weight);
  for (const c of Object.keys(adj.road)) adj.road[c] = clamp(1 + adj.road[c], LIMIT.road);

  return { n: rides.length, rated: rated.length, adj, reasons: explain(adj, why) };
}

// Klartext-Begründungen für alle nennenswerten Anpassungen
function explain(adj, why) {
  const out = [], src = key => [...(why.get(key) || [])].join(', ');
  const pct = f => (f >= 2 ? `${f.toFixed(1).replace('.', ',')}-mal so viel` : `${Math.round(Math.abs(f - 1) * 100)} %`);
  const names = { tight: 'Enge Kurven und Kehren (unter 60 m)', medium: 'Mittlere Kurven (60–175 m)', wide: 'Weite, flotte Bögen (175–300 m)' };
  for (const [g, f] of Object.entries(adj.band)) if (Math.abs(f - 1) >= 0.05) out.push(`${names[g]} zählen ${pct(f)}${f >= 2 ? '' : f > 1 ? ' mehr' : ' weniger'} – ${src(`band:${g}`)}`);
  const how = d => (Math.abs(d) >= 1 ? 'deutlich ' : Math.abs(d) < 0.3 ? 'etwas ' : '');
  if (Math.abs(adj.bonus) >= 0.02) out.push(`Kurvige Straßen werden ${adj.bonus > 0 ? 'noch stärker' : 'weniger stark'} bevorzugt – ${src('bonus')}`);
  for (const [k, d] of Object.entries(adj.weights)) {
    if (Math.abs(d) < 0.05) continue;
    const label = FEATURES.find(f => f.key === k)?.label || k;
    out.push(`${label}: wird ${how(d)}${d > 0 ? 'stärker gemieden' : 'bevorzugt'} – ${src(`w:${k}`)}`);
  }
  const cls = { primary: 'Bundesstraßen', secondary: 'Landesstraßen', tertiary: 'Kreisstraßen', unclassified: 'Nebenstraßen' };
  for (const [c, f] of Object.entries(adj.road)) if (Math.abs(f - 1) >= 0.05) out.push(`${cls[c]}: werden ${how((f - 1) * 4)}${f < 1 ? 'bevorzugt' : 'eher gemieden'} – ${src(`cls:${c}`)}`);
  return out;
}

// Profil auf die Parameter anwenden: P = Standardwerte + persönliche Anpassung (D bleibt unverändert)
export function applyProfile(P, D, profile) {
  const fresh = JSON.parse(JSON.stringify(D));
  for (const [k, v] of Object.entries(fresh)) {
    if (Array.isArray(v)) P[k] = v; else if (v && typeof v === 'object') Object.assign(P[k], v); else P[k] = v;
  }
  if (!profile) return P;
  const { adj } = profile;
  for (const [g, idx] of Object.entries(BAND_GROUPS)) for (const i of idx) if (P.bands[i]) P.bands[i][1] = +Math.min(1.25, D.bands[i][1] * adj.band[g]).toFixed(3); // Gewicht höchstens 1,25: Kurvigkeit bleibt nahe 0..1
  P.bonus = clamp(D.bonus + adj.bonus, [0.4, 0.95]);
  for (const [k, d] of Object.entries(adj.weights)) P.weights[k] = Math.max(-0.9, (D.weights[k] || 0) + d);
  for (const [c, f] of Object.entries(adj.road)) if (P.roadFactor[c] != null) P.roadFactor[c] = +(D.roadFactor[c] * f).toFixed(3);
  return P;
}
