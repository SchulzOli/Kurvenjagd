// Schnittstelle zum Rechenkern. Bevorzugt einen Web Worker (Oberfläche bleibt flüssig);
// klappt das nicht, läuft derselbe Kern im Haupt-Thread. Aufrufer merken davon nichts.
import * as R from './router.js';
import { createEngine } from './engine-core.js';

export const engineInfo = { mode: 'Web Worker', calls: {} }; // für die Boxengasse

let worker = null, local = null, seq = 0, lastWays = null;
const pending = new Map();

// Messwerte aus dem Kern übernehmen, damit die Boxengasse sie anzeigt
function finish(type, t0, data) {
  if (data.metrics?.build) R.metrics.build = data.metrics.build;
  if (data.metrics?.route) R.metrics.route = data.metrics.route;
  engineInfo.calls[type] = { ms: performance.now() - t0, at: Date.now() };
  return data.result;
}

function runLocal(type, args) {
  if (!local) {
    local = createEngine();
    engineInfo.mode = 'Haupt-Thread';
    if (lastWays && type !== 'setWays') local.handle('setWays', lastWays); // Zustand nachziehen
  }
  return local.handle(type, args);
}

// Worker gescheitert (z. B. keine Module-Worker): offene Aufträge im Haupt-Thread erledigen
function fallBack(reason) {
  worker?.terminate();
  worker = null;
  engineInfo.mode = 'Haupt-Thread';
  engineInfo.error = reason;
  for (const [id, p] of pending) {
    pending.delete(id);
    try { p.resolve(runLocal(p.type, p.args)); } catch (err) { p.reject(err); }
  }
}

try {
  worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data); else p.reject(new Error(data.error));
  };
  worker.onerror = ev => { ev.preventDefault?.(); fallBack(ev.message || 'Worker-Fehler'); };
} catch (err) {
  worker = null;
  engineInfo.mode = 'Haupt-Thread';
  engineInfo.error = err.message;
}

function call(type, args) {
  const t0 = performance.now();
  if (type === 'setWays') lastWays = args;
  if (!worker) {
    try { return Promise.resolve(finish(type, t0, runLocal(type, args))); }
    catch (err) { return Promise.reject(err); }
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { type, args, resolve: data => resolve(finish(type, t0, data)), reject });
    worker.postMessage({ id, type, args });
  });
}

export const engine = {
  // dem: Höhenmodell { z, tiles: Map } oder null; als Liste übergeben, damit es in den Worker kopiert werden kann
  setWays: (elements, dem) => call('setWays', { elements, dem: dem && { z: dem.z, tiles: [...dem.tiles] } }),
  route: (points, mode, opt) => call('route', { points, mode, opt }),
  heat: min => call('heat', { min }),
  graphStats: () => call('graphStats'),
  // Parameter aus dem Labor (R.P im Haupt-Thread) an den Kern schicken
  setParams: rebuild => call('setParams', { params: JSON.parse(JSON.stringify(R.P)), rebuild }),
};
