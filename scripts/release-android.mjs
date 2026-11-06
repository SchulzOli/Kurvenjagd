// Signierte Android-Version für die Veröffentlichung.
//   npm run release:aab   → dist/Kurvenjagd-<version>.aab (Google Play)
//   npm run release:apk   → dist/Kurvenjagd-<version>.apk (Beta über GitHub)
// Daten und Website: https://kurvenjagd.oli-tech.eu/ (Standard in scripts/build.mjs, per KJ_DATA_URL überschreibbar).
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
if (!existsSync('android/keystore.properties') && !process.env.KJ_KEYSTORE) {
  console.error('Kein Signaturschlüssel: android/keystore.properties anlegen oder KJ_KEYSTORE … setzen (docs/veroeffentlichung.md).');
  process.exit(1);
}

writeFileSync('android/local.properties', `sdk.dir=${env.ANDROID_HOME.replace(/\\/g, '/')}\n`);
const buildEnv = { ...env, KJ_CHANNEL: process.env.KJ_CHANNEL || (apk ? 'web' : 'store') };
const run = (cmd, cwd = '.') => execSync(cmd, { cwd, env: buildEnv, stdio: 'inherit' });
const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

console.log(`Kurvenjagd ${version} · ${apk ? 'APK' : 'AAB'} · Vertriebsweg ${buildEnv.KJ_CHANNEL}`);
run('node scripts/build.mjs --release');
run('npx cap sync android');
run(`${gradlew} ${apk ? 'assembleRelease' : 'bundleRelease'}`, 'android');

mkdirSync('dist', { recursive: true });
const from = apk ? 'android/app/build/outputs/apk/release/app-release.apk' : 'android/app/build/outputs/bundle/release/app-release.aab';
const to = `dist/Kurvenjagd-${version}.${apk ? 'apk' : 'aab'}`;
copyFileSync(from, to);
console.log(`\nFertig: ${to}`);
