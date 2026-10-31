// Findet JDK 21 und Android SDK für die Build-Skripte.
// Reihenfolge: JAVA_HOME/ANDROID_HOME, sonst portable Installation in D:\Android oder %LOCALAPPDATA%\Android.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = ['D:\\Android', join(process.env.LOCALAPPDATA || '', 'Android')].find(d => existsSync(join(d, 'Sdk')));
const jdk = root && readdirSync(root).find(d => d.startsWith('jdk-'));

export const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || (jdk && join(root, jdk)),
  ANDROID_HOME: process.env.ANDROID_HOME || (root && join(root, 'Sdk')),
  ANDROID_AVD_HOME: process.env.ANDROID_AVD_HOME || (root && join(root, 'avd')),
};
if (!env.JAVA_HOME || !env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) {
  throw new Error('JDK 21 oder Android SDK nicht gefunden (siehe README)');
}
env.ANDROID_SDK_ROOT = env.ANDROID_HOME;

const exe = process.platform === 'win32' ? '.exe' : '';
export const adb = join(env.ANDROID_HOME, 'platform-tools', 'adb' + exe);
export const emulator = join(env.ANDROID_HOME, 'emulator', 'emulator' + exe);
