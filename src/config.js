// Wo die App ihre Daten holt. Eingestellt beim Bauen (scripts/build.mjs, Umgebungsvariablen KJ_*),
// damit Entwicklung, Test und Veröffentlichung denselben Code nutzen.
//
// Entwicklung (npm run build): Straßenpakete und Karte aus data/ (python scripts/build_data.py,
//   node scripts/build-map.mjs), ausgeliefert von scripts/serve.mjs unter /data/. Fehlen sie, fällt die App
//   auf die öffentlichen Overpass-Server zurück. Android-Emulator: KJ_DATA_URL=http://127.0.0.1:8765/data/.
// Veröffentlichung (npm run build -- --release): Daten und Website vom eigenen Server
//   https://kurvenjagd.oli-tech.eu/ (server/README.md), Overpass wird nie benutzt.
/* global process */
const env = {
  data: process.env.KJ_DATA_URL,
  map: process.env.KJ_MAP_URL,
  geocoder: process.env.KJ_GEOCODER_URL,
  weather: process.env.KJ_WEATHER_URL,
  release: process.env.KJ_RELEASE,
  channel: process.env.KJ_CHANNEL,
  site: process.env.KJ_SITE_URL,
};
const slash = u => (u && !u.endsWith('/') ? u + '/' : u);

export const CONFIG = {
  release: env.release === '1',
  // Straßenpakete (manifest.json, roads/, local/)
  dataUrl: slash(env.data || 'data/'),
  // Vektorkarte als eine PMTiles-Datei (Protomaps)
  mapUrl: env.map || `${slash(env.data || 'data/')}map.pmtiles`,
  // Ortssuche (Photon: …/api/ und …/reverse); ab einigen tausend Nutzern eigene Instanz
  geocoderUrl: slash(env.geocoder || 'https://photon.komoot.io/'),
  // Wetter (Open-Meteo-API); mit bezahltem Tarif: customer-api.open-meteo.com mit Schlüssel
  weatherUrl: env.weather || 'https://api.open-meteo.com/v1/forecast',
  // Öffentliche Overpass-Server nur beim Entwickeln, wenn keine Pakete da sind
  overpassFallback: env.release !== '1',
  // Vertriebsweg: 'web' und 'fdroid' zeigen Spenden-Links; 'store' (Google Play, App Store) ausschließlich
  // Trinkgeld per In-App-Kauf – externe Spenden-Links sind dort nicht erlaubt. Ohne Angabe: nativ 'store', sonst 'web'.
  channel: env.channel || null,
  // Website mit Datenschutzerklärung und Impressum
  siteUrl: slash(env.site || 'https://kurvenjagd.oli-tech.eu/'),
};
