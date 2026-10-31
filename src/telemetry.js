// Ereignis-Protokoll und Dienst-Status für die Boxengasse. Ohne UI, damit es überall importierbar ist.

const MAX = 300;
export const events = [];      // { t, kind, text }
export const services = {};    // Name -> { ok, ms, at, info }
export const counters = { tilesOk: 0, tilesErr: 0, reroutes: 0, commands: 0, announcements: 0 };

export function log(kind, text) {
  events.push({ t: Date.now(), kind, text });
  if (events.length > MAX) events.shift();
}

// Misst Antwortzeit und Erfolg eines Netzaufrufs
export async function timed(name, promise) {
  const t0 = performance.now();
  try {
    const res = await promise;
    services[name] = { ok: res?.ok !== false, ms: Math.round(performance.now() - t0), at: Date.now(), info: res?.status ? `HTTP ${res.status}` : '' };
    return res;
  } catch (err) {
    services[name] = { ok: false, ms: Math.round(performance.now() - t0), at: Date.now(), info: err.message };
    throw err;
  }
}
