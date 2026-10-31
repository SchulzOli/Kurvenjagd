// node --test   (Fahrprofil: Aufzeichnung auswerten, aus Bewertungen lernen, auf den Algorithmus anwenden)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from './src/router.js';
import { coveredSteps, rideFeatures, learn, applyProfile, TAGS } from './src/profile.js';
import { createEngine } from './src/engine-core.js';

const LAT0 = 48, LON0 = 8;
const toLL = ([x, y]) => [LAT0 + y / 110540, LON0 + x / (111320 * Math.cos(LAT0 * Math.PI / 180))];
const way = (id, pts, nodes) => ({ type: 'way', id, tags: { highway: 'tertiary' }, nodes,
  geometry: pts.map(toLL).map(([lat, lon]) => ({ lat, lon })) });
const fresh = () => JSON.parse(JSON.stringify(R.DEFAULTS));

// Kehren-Strecke: Abschnitte mit engen Wellen (r ≈ 20 m) im Wechsel mit Geraden
const tight = Array.from({ length: 401 }, (_, i) => [i * 5, 150 + 18 * Math.sin(2 * Math.PI * i * 5 / 90) * (Math.floor(i / 20) % 3 === 0)]);
tight[0] = [0, 0]; tight[400] = [2000, 0];
// Bogen-Strecke: S-Kurven mit Radius 220 m
const wide = [[0, 0]];
for (let i = 1, h = 0, x = 0, y = -150; i < 400; i++) {
  h += (Math.floor(i / 30) % 2 ? 1 : -1) * 5 / 220; x += 5 * Math.cos(h); y += 5 * Math.sin(h);
  wide.push([x, y]);
}
wide.push([2000, 0]);
const ways = [way(1, tight, tight.map((_, i) => i === 0 ? 1 : i === 400 ? 2 : 1000 + i)),
  way(2, wide, wide.map((_, i) => i === 0 ? 1 : i === 400 ? 2 : 5000 + i))];
const step = (pts, extra) => { const geom = pts.map(toLL); return { geom, len: 0, hw: 'tertiary', curv: R.curviness(geom), f: {}, ...extra }; };
const withLen = s => ({ ...s, len: s.geom.slice(1).reduce((a, p, i) => a + R.haversine(s.geom[i], p), 0) });

test('Gefahrener Teil: ganze Kanten bis zur Position, die letzte anteilig', () => {
  const steps = [{ len: 1000 }, { len: 500 }, { len: 800 }];
  const c = coveredSteps(steps, 1250);
  assert.equal(c.length, 2);
  assert.equal(c[0].len, 1000);
  assert.equal(c[1].len, 250);
  assert.equal(coveredSteps(steps, 0).length, 0);
  assert.equal(coveredSteps(steps, 99999).reduce((a, s) => a + s.len, 0), 2300);
});

test('Strecken-Eigenschaften: Kurvenarten, Merkmale und Straßenklassen als Anteile', () => {
  const t = withLen(step(tight)), w = withLen(step(wide, { hw: 'secondary', f: { rough: 1 } }));
  const ft = rideFeatures([t], R.bendMeters), fw = rideFeatures([w], R.bendMeters);
  assert.ok(ft.bands.tight > 0.2 && ft.bands.wide < 0.05, JSON.stringify(ft.bands));
  assert.ok(fw.bands.wide > 0.4 && fw.bands.tight < 0.05, JSON.stringify(fw.bands));
  const both = rideFeatures([t, w], R.bendMeters);
  const share = w.len / (t.len + w.len);
  assert.ok(Math.abs(both.feat.rough - share) < 1e-9, 'Merkmal nach Länge gewichtet');
  assert.ok(Math.abs(both.cls.secondary - share) < 1e-9);
  const sum = Object.values(both.bands).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.02, `Kurvenarten ergeben zusammen die Strecke (${sum})`);
});

test('Ohne Fahrten bleibt alles beim Standard', () => {
  const p = learn([]);
  assert.deepEqual(p.adj.band, { tight: 1, medium: 1, wide: 1 });
  assert.equal(p.reasons.length, 0);
  const P = applyProfile(fresh(), R.DEFAULTS, p);
  assert.deepEqual(P, R.DEFAULTS);
});

test('Schnell-Tags wirken direkt, jüngere Fahrten stärker, mit Begründung', () => {
  const p = learn([{ tags: ['hairpins', 'rough'] }]);
  assert.ok(p.adj.band.tight > 1);
  assert.ok(p.adj.weights.rough > 0 && p.adj.weights.cobble > 0);
  assert.ok(p.reasons.some(r => r.includes('Enge Kurven') && r.includes('Spitzkehren super')), p.reasons.join(' | '));
  assert.ok(p.reasons.some(r => r.includes('gemieden') && r.includes('Zu holprig')));
  // „Mehr Kurven“ vor zehn Fahrten wiegt weniger als gestern
  const old = learn([...Array(9).fill({ tags: [] }), { tags: ['moreCurves'] }]), recent = learn([{ tags: ['moreCurves'] }]);
  assert.ok(recent.adj.band.tight > old.adj.band.tight);
  assert.ok(TAGS.every(t => t.label && t.delta));
});

test('Anpassungen bleiben in festen Grenzen', () => {
  const p = learn(Array(60).fill({ tags: ['moreCurves', 'hairpins', 'rough'] }));
  assert.equal(p.adj.band.tight, 1.25);
  assert.ok(p.adj.bonus <= 0.1);
  assert.ok(p.adj.weights.rough <= 3);
  const P = applyProfile(fresh(), R.DEFAULTS, p);
  assert.ok(P.bands.every(([, w]) => w <= 1.25), 'Kurvengewicht höchstens 1,25');
  assert.ok(P.bonus <= 0.95);
});

test('Sterne: erst ab 3 Bewertungen, dann Vorliebe für das, was gut bewertet wurde', () => {
  const feat = (tightShare, wideShare) => ({ km: 50000, bands: { tight: tightShare, medium: 0.1, wide: wideShare, straight: 1 - tightShare - wideShare - 0.1 }, feat: {}, cls: { tertiary: 1 } });
  const two = learn([{ rating: 5, features: feat(0.4, 0.05) }, { rating: 1, features: feat(0.05, 0.4) }]);
  assert.equal(two.adj.band.tight, 1, 'mit 2 Bewertungen noch nichts gelernt');
  // Kehren-Touren gut, Bogen-Touren schlecht bewertet
  const rides = [];
  for (let i = 0; i < 8; i++) rides.push({ rating: 5, features: feat(0.35 + i * 0.01, 0.05) }, { rating: 2, features: feat(0.05, 0.35 + i * 0.01) });
  const p = learn(rides);
  assert.ok(p.adj.band.tight > 1.05, `eng ${p.adj.band.tight}`);
  assert.ok(p.adj.band.wide < 0.95, `weit ${p.adj.band.wide}`);
  assert.ok(p.reasons.some(r => r.includes('gut bewertete Touren hatten mehr davon')));
  // gleiche Strecken mit wechselnden Sternen: kein Zusammenhang, keine Anpassung
  const noise = learn(Array.from({ length: 10 }, (_, i) => ({ rating: 1 + (i % 5), features: feat(0.2, 0.2) })));
  assert.equal(noise.reasons.length, 0, noise.reasons.join(' | '));
});

test('Profil anwenden verändert P, Abschalten stellt die Standardwerte wieder her', () => {
  const P = fresh(), snapshot = JSON.stringify(R.DEFAULTS);
  applyProfile(P, R.DEFAULTS, learn([{ tags: ['flowing', 'urban'] }]));
  assert.ok(P.bands[4][1] > R.DEFAULTS.bands[4][1], 'weite Bögen zählen mehr');
  assert.ok(P.bands[0][1] < R.DEFAULTS.bands[0][1], 'Kehren weniger');
  assert.ok(P.weights.slow > 0, 'Ortsdurchfahrten werden gemieden');
  applyProfile(P, R.DEFAULTS, null);
  assert.equal(JSON.stringify(P), snapshot);
  assert.equal(JSON.stringify(R.DEFAULTS), snapshot, 'DEFAULTS bleiben unberührt');
});

test('Gelerntes Profil ändert die Routenwahl: „Lieber flotte Bögen“ statt Kehren', () => {
  const eng = createEngine(), pts = [toLL([0, 0]), toLL([2000, 0])];
  const opt = { curvy: 0.8, maxDetour: 3, avoidHighway: true };
  const route = params => {
    eng.handle('setParams', { params, rebuild: false });
    eng.handle('setWays', { elements: ways });
    return eng.handle('route', { points: pts, mode: 'ab', opt }).result.route;
  };
  try {
    const std = route(fresh());
    const mine = route(applyProfile(fresh(), R.DEFAULTS, learn(Array(5).fill({ tags: ['flowing'] }))));
    const bands = r => rideFeatures(r.steps, R.bendMeters).bands;
    assert.ok(bands(std).tight > 0.2, 'Standard: Kehren-Strecke');
    assert.ok(bands(mine).wide > 0.4 && bands(mine).tight < 0.05, 'Profil: Bogen-Strecke');
  } finally {
    eng.handle('setParams', { params: fresh(), rebuild: false });
  }
});
