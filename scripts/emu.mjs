// Startet den Android-Emulator (falls nötig), baut die APK, installiert und öffnet die App.
//   npm run emu              -> bauen + installieren + starten
//   npm run emu -- --no-build -> vorhandene APK verwenden
// Testdaten (data/, siehe scripts/build_data.py) holt die App per `adb reverse` vom Testserver am PC
// (node scripts/serve.mjs, Port 8765) – wie später vom eigenen Speicher.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { env, adb, emulator } from './android-env.mjs';

const AVD = 'Kurvenjaeger';
const APP = 'de.kurvenjaeger.app';
const START = ['7.85', '47.99']; // GPS-Position im Emulator: Freiburg (Länge, Breite)

const sh = (file, args) => execFileSync(file, args, { env, encoding: 'utf8' }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DATA_PORT = 8765;
const testData = !process.env.KJ_DATA_URL && existsSync('data/manifest.json');
const buildEnv = testData ? { ...env, KJ_DATA_URL: `http://127.0.0.1:${DATA_PORT}/data/` } : env;
if (!process.argv.includes('--no-build')) execFileSync('node', ['scripts/apk.mjs'], { env: buildEnv, stdio: 'inherit' });

sh(adb, ['start-server']);
if (!/^emulator-\d+\s+device/m.test(sh(adb, ['devices']))) {
  console.log(`Starte Emulator "${AVD}" …`);
  spawn(emulator, ['-avd', AVD], { env, detached: true, stdio: 'ignore' }).unref();
  sh(adb, ['wait-for-device']);
}
process.stdout.write('Warte auf Android-Start');
while (sh(adb, ['shell', 'getprop', 'sys.boot_completed']) !== '1') { process.stdout.write('.'); await sleep(2000); }
console.log(' bereit');

sh(adb, ['emu', 'geo', 'fix', ...START]);
if (testData) {
  sh(adb, ['reverse', `tcp:${DATA_PORT}`, `tcp:${DATA_PORT}`]);
  console.log(`Testdaten: Emulator lädt von http://127.0.0.1:${DATA_PORT}/data/ (Testserver muss laufen: node scripts/serve.mjs)`);
}
console.log(sh(adb, ['install', '-r', 'dist/Kurvenjaeger-debug.apk']));
sh(adb, ['shell', 'am', 'start', '-n', `${APP}/.MainActivity`]);
console.log('App gestartet. Debuggen: chrome://inspect in Chrome am PC.');
