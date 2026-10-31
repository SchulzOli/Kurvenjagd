// Sonnenstand und Blendung. Reine Berechnung (astronomische Näherung wie in der Bibliothek SunCalc,
// Genauigkeit ~1 Minute / wenige Zehntelgrad) – kein Dienst, funktioniert offline.
import { buildTrack, pointAt, bearing } from './nav.js';

const RAD = Math.PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545, E = RAD * 23.4397;
const toDays = ms => ms / DAY - 0.5 + J1970 - J2000;
const fromJulian = j => (j + 0.5 - J1970) * DAY;
const meanAnomaly = d => RAD * (357.5291 + 0.98560028 * d);
const eclipticLon = M => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
const declination = L => Math.asin(Math.sin(E) * Math.sin(L));
const rightAscension = L => Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L));

// Sonnenposition: azimuth in Grad ab Nord im Uhrzeigersinn, altitude in Grad über dem Horizont
export function sunPosition(ms, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
  const L = eclipticLon(meanAnomaly(d)), dec = declination(L), H = RAD * (280.16 + 360.9856235 * d) - lw - rightAscension(L);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); // ab Süd, westwärts
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return { azimuth: (az / RAD + 180) % 360, altitude: alt / RAD };
}

// Sonnenaufgang und -untergang (ms) für den Tag von `ms` am Ort; null in Polarnacht/-tag
export function sunTimes(ms, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n, M = meanAnomaly(ds), L = eclipticLon(M), dec = declination(L);
  const transit = a => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const noon = transit(ds);
  const cosW = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (Math.abs(cosW) > 1) return null;
  const set = transit(0.0009 + (Math.acos(cosW) + lw) / (2 * Math.PI) + n);
  return { sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set), noon: fromJulian(noon) };
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export const GLARE = { maxAltitude: 25, maxAngle: 35, minLength: 400, step: 250 };

// Abschnitte mit tief stehender Sonne in Fahrtrichtung. coords: Route, departMs: Abfahrt, totalS: Fahrzeit (s).
// Uhrzeit je Punkt wird über die Strecke verteilt (gleichmäßiges Tempo).
export function glareSegments(coords, departMs, totalS) {
  const track = buildTrack(coords), out = [];
  let cur = null;
  for (let d = 0; d < track.total; d += GLARE.step) {
    const p = pointAt(track, d), heading = bearing(p, pointAt(track, Math.min(track.total, d + 60)));
    const at = departMs + totalS * 1000 * d / (track.total || 1);
    const sun = sunPosition(at, p[0], p[1]);
    const glare = sun.altitude > 0 && sun.altitude < GLARE.maxAltitude && angleDiff(heading, sun.azimuth) < GLARE.maxAngle;
    if (glare) {
      if (cur && d - cur.to <= GLARE.step * 1.5) cur.to = d + GLARE.step;
      else out.push(cur = { from: d, to: d + GLARE.step, at, altitude: sun.altitude, azimuth: sun.azimuth });
    }
  }
  return out.map(s => ({ ...s, to: Math.min(s.to, track.total) })).filter(s => s.to - s.from >= GLARE.minLength);
}

// Blendet die Sonne gerade? (für die Live-Ansage während der Fahrt)
export function glareNow(ms, [lat, lon], heading) {
  const sun = sunPosition(ms, lat, lon);
  return sun.altitude > 0 && sun.altitude < GLARE.maxAltitude && angleDiff(heading, sun.azimuth) < GLARE.maxAngle ? sun : null;
}
