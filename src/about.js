// „Über Kurvenjäger“: Version, Datenschutz in Kürze, Datenquellen und Lizenzen, Links zu Datenschutzerklärung,
// Impressum und Quellcode. Pflicht für die Stores (Datenschutz-Link) und für die Lizenzen (OSM, CC BY …).
import { Capacitor } from '@capacitor/core';
import { CONFIG } from './config.js';
import pkg from '../package.json';

const $ = id => document.getElementById(id);
const REPO = 'https://github.com/SchulzOli/Kurvenjagd';
const link = (href, title, text) => `<a class="way" href="${href}" target="_blank" rel="noopener"><b>${title}</b><span>${text}</span></a>`;

const SOURCES = [
  ['OpenStreetMap', 'https://www.openstreetmap.org/copyright', 'Straßen, Orte, Tankstellen · © OpenStreetMap-Mitwirkende, ODbL'],
  ['Protomaps', 'https://protomaps.com', 'Kartenschema der Vektorkarte · BSD-3-Clause'],
  ['Terrain Tiles auf AWS', 'https://registry.opendata.aws/terrain-tiles/', 'Höhenmodell · u. a. SRTM, EU-DEM (Copernicus), GMTED2010'],
  ['Open-Meteo', 'https://open-meteo.com', 'Wettervorhersage · CC BY 4.0'],
  ['Photon von komoot', 'https://photon.komoot.io', 'Ortssuche · Daten © OpenStreetMap'],
];
const LIBS = 'Leaflet (BSD-2-Clause), protomaps-leaflet, pmtiles, @protomaps/basemaps (BSD-3-Clause), fflate, Capacitor und Plugins, cordova-plugin-purchase (MIT)';

export function initAbout() {
  function render() {
    const site = CONFIG.siteUrl;
    $('aboutBody').innerHTML = `
      <p class="dlgnote">Version ${pkg.version} · ${Capacitor.getPlatform()}${CONFIG.release ? '' : ' · Entwicklungsversion'}</p>
      <p>Kurvenreiche Motorradrouten aus OpenStreetMap. Kostenlos, Open Source, ohne Werbung und ohne Konto.</p>
      <h3>Datenschutz in Kürze</h3>
      <ul class="plain">
        <li>Routen, Fahrten, GPS-Spuren und dein Fahrprofil bleiben <b>nur auf diesem Gerät</b>. Kein Konto, kein Tracking, keine Werbung.</li>
        <li>Für Karte, Straßen, Höhen, Wetter und Ortssuche fragt die App öffentliche Dienste nach Kartenausschnitten, Orten oder Suchbegriffen. Dabei sehen diese deine IP-Adresse, aber keine Kennung von dir.</li>
        <li>Sprachbefehle nutzen die Spracherkennung des Geräts; dabei wird die Aufnahme meist an Google übertragen.</li>
      </ul>
      ${link(`${site}datenschutz.html`, 'Datenschutzerklärung', 'Welche Daten wohin gehen')}
      ${link(`${site}impressum.html`, 'Impressum', 'Anbieter und Kontakt')}
      <h3>Datenquellen</h3>
      ${SOURCES.map(([name, href, text]) => link(href, name, text)).join('')}
      <h3>Software</h3>
      ${link(REPO, 'Quellcode auf GitHub', 'GNU General Public License v3.0 – frei nutzbar, veränderbar, weitergebbar')}
      ${link(`${REPO}/blob/main/NOTICE.md`, 'Lizenzen aller Bestandteile', LIBS)}`;
  }
  const open = () => { render(); $('library').hidden = true; $('about').hidden = false; };
  document.querySelectorAll('[data-about]').forEach(b => b.addEventListener('click', open));
  $('aboutClose').addEventListener('click', () => { $('about').hidden = true; });
  return { open };
}
