// Signierte Android-Version für die Veröffentlichung.
//   KJ_DATA_URL=https://daten.example.org/v1/ node scripts/release-android.mjs          → dist/Kurvenjaeger-<version>.aab (Google Play)
//   KJ_DATA_URL=https://daten.example.org/v1/ node scripts/release-android.mjs --apk    → dist/Kurvenjaeger-<version>.apk (Beta über GitHub)
//
// Google Play bekommt den Vertriebsweg „store“ (Trinkgeld nur per In-App-Kauf), die APK für GitHub den Weg „web“
// (Spenden-Links), weil In-App-Käufe außerhalb des Stores nicht funktionieren.
// Signaturschlüssel: android/keystore.properties oder KJ_KEYSTORE, KJ_KEYSTORE_PASSWORD, KJ_KEY_ALIAS, KJ_KEY_PASSWORD
// (Anleitung: docs/veroeffentlichung.md). Version: "version" in package.json vor jeder Veröffentlichung erhöhen.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { env } from './android-env.mjs';

const apk = process.argv.includes('--apk');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!process.env.KJ_DATA_URL) {
  console.error('KJ_DATA_URL fehlt: Adresse des Datenspeichers, z. B. https://daten.example.org/v1/');
  process.exit(1);
}
if (!existsSync('android/keystore.properties') && !process.env.KJ_KEYSTORE) {
  console.error('Kein Signaturschlüssel: android/keystore.properties anlegen oder KJ_KEYSTORE … setzen (docs/veroeffentlichung.md).');
  process.exit(1);
}

writeFileSync('android/local.properties', `sdk.dir=${env.ANDROID_HOME.replace(/\\/g, '/')}\n`);
const buildEnv = { ...env, KJ_CHANNEL: process.env.KJ_CHANNEL || (apk ? 'web' : 'store') };
const run = (cmd, cwd = '.') => execSync(cmd, { cwd, env: buildEnv, stdio: 'inherit' });
const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

console.log(`Kurvenjäger ${version} · ${apk ? 'APK' : 'AAB'} · Vertriebsweg ${buildEnv.KJ_CHANNEL} · Daten ${process.env.KJ_DATA_URL}`);
run('node scripts/build.mjs --release');
run('npx cap sync android');
run(`${gradlew} ${apk ? 'assembleRelease' : 'bundleRelease'}`, 'android');

mkdirSync('dist', { recursive: true });
const from = apk ? 'android/app/build/outputs/apk/release/app-release.apk' : 'android/app/build/outputs/bundle/release/app-release.aab';
const to = `dist/Kurvenjaeger-${version}.${apk ? 'apk' : 'aab'}`;
copyFileSync(from, to);
console.log(`\nFertig: ${to}`);
