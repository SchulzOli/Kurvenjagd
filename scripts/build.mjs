// Bündelt src/app.js (inkl. Leaflet & Capacitor) nach www/build/
//   npm run build                  Entwicklung: Daten von data/ über scripts/serve.mjs, sonst Overpass
//   npm run build -- --release     Veröffentlichung: KJ_DATA_URL muss gesetzt sein (eigener Speicher/CDN)
// Weitere Umgebungsvariablen (optional): KJ_MAP_URL, KJ_GEOCODER_URL, KJ_WEATHER_URL,
// KJ_CHANNEL (web | fdroid | store; bestimmt die Unterstützen-Wege) – siehe src/config.js
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const release = process.argv.includes('--release');
if (release && !process.env.KJ_DATA_URL) {
  console.error('Für --release muss KJ_DATA_URL gesetzt sein (z. B. https://daten.kurvenjaeger.de/v1/).');
  process.exit(1);
}
const vars = ['KJ_DATA_URL', 'KJ_MAP_URL', 'KJ_GEOCODER_URL', 'KJ_WEATHER_URL', 'KJ_CHANNEL'];
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
