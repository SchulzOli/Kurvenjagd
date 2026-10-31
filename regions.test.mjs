// node --test   (Offline-Regionen und Offline-Verhalten des Laders)
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksFor, estimate, checkBbox, PRESETS } from './src/regions.js';
import { fresh, loadArea, tilesFor } from './src/tiles.js';

test('Region wird in Blöcke zu höchstens 4 × 4 Kacheln geteilt', () => {
  const bbox = [47.6, 7.6, 48.9, 8.7]; // Schwarzwald
  const blocks = blocksFor(bbox);
  assert.equal(blocks.flat().length, tilesFor(bbox).length, 'jede Kachel genau einmal');
  assert.ok(blocks.every(b => b.length <= 16));
  const est = estimate(bbox);
  assert.equal(est.blocks, blocks.length);
  assert.ok(est.bytes > 10e6 && est.bytes < 80e6, `Schätzung ${est.bytes}`);
});

test('Alle Voreinstellungen sind innerhalb der erlaubten Größe', () => {
  for (const p of PRESETS) assert.doesNotThrow(() => checkBbox(p.bbox), p.name);
  assert.throws(() => checkBbox([47, 7, 49, 9]), /zu groß/);
});

test('Angepinnte Kacheln verfallen nicht, normale nach 30 Tagen', () => {
  const old = Date.now() - 40 * 24 * 3600 * 1000;
  assert.equal(fresh({ v: 3, t: old }), false);
  assert.equal(fresh({ v: 3, t: old, pins: ['schwarzwald'] }), true);
  assert.equal(fresh({ v: 2, t: Date.now(), pins: ['x'] }), false, 'alte Cache-Version gilt nie');
});

test('Offline ohne heruntergeladene Region: sofort klare Meldung statt Warten', async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  const t0 = performance.now();
  try {
    await assert.rejects(loadArea([48.0, 8.0, 48.05, 8.05], [[48.02, 8.02]]), /nicht heruntergeladen/);
    assert.ok(performance.now() - t0 < 2000, 'kein Warten auf Server');
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc); else delete globalThis.navigator;
  }
});

test('Alle Server ohne Antwort (kein Netz): sofort aufgeben und Netz als weg markieren', async () => {
  const { overpass } = await import('./src/router.js');
  const { net, isOnline } = await import('./src/net.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  const t0 = performance.now();
  try {
    await assert.rejects(overpass('[out:json];node(1);out;'), /Kein Netz/);
    assert.ok(performance.now() - t0 < 1000, `aufgegeben nach ${Math.round(performance.now() - t0)} ms`);
    assert.equal(isOnline(), false, 'Netz gilt als weg');
  } finally {
    globalThis.fetch = realFetch;
    net.downUntil = 0;
  }
});
