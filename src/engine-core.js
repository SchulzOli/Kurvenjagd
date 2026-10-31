// Rechenkern: hält das Straßennetz und beantwortet Anfragen (Route, Heatmap, Statistik).
// Läuft im Web Worker (engine-worker.js) oder – falls nicht möglich – direkt im Haupt-Thread.
// Alle Ergebnisse sind reine Daten, damit sie zwischen den Threads kopiert werden können.
import * as R from './router.js';
import { maneuvers } from './nav.js';
import { FEATURES } from './features.js';

// Parameter übernehmen, ohne das Objekt R.P auszutauschen (andere Module halten eine Referenz)
function assignParams(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) target[k] = v.map(x => (Array.isArray(x) ? [...x] : x));
    else if (v && typeof v === 'object') Object.assign(target[k], v);
    else target[k] = v;
  }
}

export function createEngine() {
  let g = null, elements = [], dem = null;
  // Kanten-Infos für die Anzeige, inkl. Merkmale (nur Werte ≠ 0)
  const edgeView = e => ({ geom: e.geom, curv: e.curv, name: e.name, hw: e.hw, len: e.len, f: R.edgeFeatures(g, e.id) });

  // Eine Route (Ergebnis von summarize) als klonbare Daten: Kanten-Infos statt Kanten-IDs
  const viewOf = r => ({
    coords: r.coords, len: r.len, time: r.time, curvyLen: r.curvyLen, reuse: r.reuse, avgCurv: r.avgCurv,
    curvyUsed: r.curvyUsed, legs: r.legs, up: r.up, down: r.down, steps: r.steps.map(s => edgeView(g.edges[s.e])),
  });

  // Ergebnis des Routers in klonbare Daten übersetzen. Bei Start → Ziel zusätzlich Alternativen:
  // eine zweite kurvige Variante und die zügige Route (falls sie sich deutlich unterscheiden).
  function routeView(res, mode, points, opt) {
    const r = res.route;
    const out = {
      mode, points, selected: 'main',
      route: viewOf(r),
      base: res.base && { coords: res.base.coords, len: res.base.len, time: res.base.time, curvyLen: res.base.curvyLen, avgCurv: res.base.avgCurv, up: res.base.up, down: res.base.down },
      snapped: res.snapped.map(v => [g.lat[v], g.lon[v]]),
      waypoints: res.waypoints.map(v => [g.lat[v], g.lon[v]]),
      maneuvers: maneuvers(g, r).list,
      alternatives: [],
    };
    if (mode === 'ab' && opt.alternatives) {
      const alts = [{ key: 'main', label: 'Empfohlen', r, overlap: 1 }]; // beste nach Gesamtbewertung, nicht zwingend die kurvigste
      const alt = R.alternativeRoute(g, res.snapped, { ...opt, curvy: r.curvyUsed }, r.steps);
      if (alt) alts.push({ key: 'alt', label: 'Alternative', r: alt, overlap: R.overlap(g, r.steps, alt.steps) });
      if (res.base) alts.push({ key: 'fast', label: 'Zügig', r: res.base, overlap: R.overlap(g, r.steps, res.base.steps) });
      // nur Varianten, die sich wirklich unterscheiden (höchstens 80 % gemeinsame Strecke)
      out.alternatives = alts.filter(a => a.key === 'main' || a.overlap <= 0.8)
        .map(a => ({ key: a.key, label: a.label, overlap: a.overlap, route: a.key === 'main' ? out.route : viewOf(a.r),
          maneuvers: a.key === 'main' ? out.maneuvers : maneuvers(g, a.r).list }));
    }
    return out;
  }

  function graphStats() {
    const classes = {}, hist = new Array(10).fill(0), K = FEATURES.length;
    const knownKm = new Array(K).fill(0), featKm = new Array(K).fill(0);
    let total = 0, points = 0, dead = 0;
    for (const e of g.edges) {
      if (e.dead) { dead++; continue; }
      const c = e.hw.replace(/_link$/, '');
      classes[c] = (classes[c] || 0) + e.len;
      hist[Math.min(9, Math.floor(e.curv / 0.05))] += e.len;
      total += e.len; points += e.geom.length;
      // Datenabdeckung: Hat OSM für diesen Abschnitt überhaupt Angaben? Und wie oft trifft das Merkmal zu?
      const known = g.col.known[e.id];
      for (let i = 0; i < K; i++) {
        if (known & (1 << i)) knownKm[i] += e.len;
        featKm[i] += e.len * g.col.feat[e.id * K + i]; // mit dem Wert gewichtet (z. B. 30 % steil = 0,3 × Länge)
      }
    }
    const features = FEATURES.map((f, i) => ({ key: f.key, label: f.label, tags: f.tags, implicit: !!f.implicit, known: knownKm[i] / (total || 1), km: featKm[i] }));
    // grobe Speicherschätzung: Koordinaten (2 × 8 Byte + Array-Overhead) + Objekt je Kante/Knoten
    return { nodes: g.lat.length, edges: g.edges.length - dead, dead, classes, hist, total, points, features,
      turns: { used: g.turn.used, skipped: g.turn.skipped, via: g.turn.via.size }, dem: g.dem ? { z: g.dem.z, tiles: g.dem.tiles.size } : null,
      memory: points * 40 + g.edges.length * 200 + g.lat.length * 60 };
  }

  const need = () => { if (!g) throw new Error('Kein Straßennetz geladen'); return g; };

  const handlers = {
    setWays(args) {
      elements = args.elements;
      dem = args.dem ? { z: args.dem.z, tiles: new Map(args.dem.tiles) } : null;
      g = R.buildGraph({ elements }, dem);
      return { nodes: g.lat.length, edges: g.edges.length, turns: g.turn.used, dem: !!dem };
    },
    setParams({ params, rebuild }) {
      assignParams(R.P, params);
      if (rebuild && elements.length) g = R.buildGraph({ elements }, dem); // Kurvigkeit neu vermessen
      return true;
    },
    route({ points, mode, opt }) {
      need();
      const res = mode === 'ab' ? R.routeVia(g, points, opt) : R.roundTrip(g, points[0], opt);
      return routeView(res, mode, points, opt);
    },
    heat({ min }) { return g ? g.edges.filter(e => !e.dead && e.curv >= min).map(edgeView) : []; },
    graphStats() { return g ? graphStats() : null; },
  };

  return {
    handle(type, args = {}) {
      const result = handlers[type](args);
      return { result, metrics: { build: R.metrics.build, route: R.metrics.route } };
    },
  };
}
