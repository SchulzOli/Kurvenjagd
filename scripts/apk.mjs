// Baut eine Debug-APK: Web-Bundle -> cap sync -> Gradle. Ergebnis: dist/Kurvenjagd-debug.apk
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { env } from './android-env.mjs';

// Gradle findet das SDK über local.properties
writeFileSync('android/local.properties', `sdk.dir=${env.ANDROID_HOME.replace(/\\/g, '/')}\n`);

const run = (cmd, cwd = '.') => execSync(cmd, { cwd, env, stdio: 'inherit' });
run('npm run build');
run('npx cap sync android');
run(process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', 'android');

mkdirSync('dist', { recursive: true });
copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk', 'dist/Kurvenjagd-debug.apk');
console.log('\nAPK: dist/Kurvenjagd-debug.apk');
