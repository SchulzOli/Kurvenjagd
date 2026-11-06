// Bündelt src/app.js (inkl. Leaflet & Capacitor) nach www/build/
//   npm run build                  Entwicklung: Daten von data/ über scripts/serve.mjs, sonst Overpass
//   npm run build -- --release     Veröffentlichung: Daten und Website von https://kurvenjagd.oli-tech.eu/
// Weitere Umgebungsvariablen (optional): KJ_MAP_URL, KJ_GEOCODER_URL, KJ_WEATHER_URL,
// KJ_CHANNEL (web | fdroid | store; bestimmt die Unterstützen-Wege), KJ_SITE_URL (Website) – siehe src/config.js
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const release = process.argv.includes('--release');
// Veröffentlichung: eigener Server (server/README.md); per KJ_DATA_URL / KJ_SITE_URL überschreibbar
if (release) {
  process.env.KJ_DATA_URL ||= 'https://kurvenjagd.oli-tech.eu/daten/v1/';
  process.env.KJ_SITE_URL ||= 'https://kurvenjagd.oli-tech.eu/';
  console.log(`Veröffentlichung: Daten ${process.env.KJ_DATA_URL} · Website ${process.env.KJ_SITE_URL}`);
}
const vars = ['KJ_DATA_URL', 'KJ_MAP_URL', 'KJ_GEOCODER_URL', 'KJ_WEATHER_URL', 'KJ_CHANNEL', 'KJ_SITE_URL'];
const define = Object.fromEntries(vars.map(v => [`process.env.${v}`, JSON.stringify(process.env[v] || '')]));
define['process.env.KJ_RELEASE'] = JSON.stringify(release ? '1' : '');

const options = {
  entryPoints: ['src/app.js', 'src/engine-worker.js'], // Worker als eigene Datei
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome90'], // Capacitor 8: iOS 15+
  outdir: 'www/build',
  minify: !watch,
  sourcemap: true,
  loader: { '.png': 'file', '.svg': 'file' },
  define,
  logLevel: 'info',
};

if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
