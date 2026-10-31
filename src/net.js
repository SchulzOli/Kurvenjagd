// Netzstatus. navigator.onLine allein reicht nicht: Die Android-WebView meldet „online“, auch wenn
// das Netz weg ist. Deshalb zusätzlich:
//  - der native Status (Capacitor-Plugin @capacitor/network, in app.js angebunden),
//  - „gemessenes“ Offline: scheitern alle Server mit Netzwerkfehlern, gilt das Netz eine Weile als weg.
// Ohne DOM-Abhängigkeit, damit der Router (auch im Worker) es nutzen kann.

export const net = { native: null, downUntil: 0 };

export const isOnline = () =>
  (typeof navigator === 'undefined' || navigator.onLine !== false) && net.native !== false && Date.now() > net.downUntil;

// Netz als ausgefallen markieren (z. B. alle Overpass-Server mit Netzwerkfehler); löst ein Ereignis aus,
// damit die Oberfläche auf die Offline-Karte umschalten kann
export function markDown(ms = 60_000) {
  net.downUntil = Date.now() + ms;
  globalThis.dispatchEvent?.(new Event('kj-net'));
}

export function markUp() {
  net.downUntil = 0;
  globalThis.dispatchEvent?.(new Event('kj-net'));
}

// Fehler von fetch ohne Server-Antwort (kein Netz, DNS, abgelehnte Verbindung)
export const isNetworkError = err => err?.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed|network/i.test(err?.message || '');
