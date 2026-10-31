// Web Worker: führt den Rechenkern in einem eigenen Thread aus, damit die Oberfläche nie blockiert.
import { createEngine } from './engine-core.js';

const engine = createEngine();

self.onmessage = ({ data: { id, type, args } }) => {
  try {
    const { result, metrics } = engine.handle(type, args);
    self.postMessage({ id, ok: true, result, metrics });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
