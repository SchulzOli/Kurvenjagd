// Sprachausgabe, Spracheingabe und „Bildschirm an“ – nativ über Capacitor-Plugins, im Browser über Web-APIs.
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { KeepAwake } from '@capacitor-community/keep-awake';

const native = Capacitor.isNativePlatform();
const WebRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
let queue = Promise.resolve();

// Sprachansagen an/aus (wird gespeichert, gilt für Planung und Fahrt)
const PREF = 'kj.voice';
let voiceOn = (() => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } })();
export const voiceEnabled = () => voiceOn;
export function setVoice(on) {
  voiceOn = on;
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* privater Modus */ }
  if (!on) { // laufende Ansage sofort abbrechen
    queue = Promise.resolve();
    if (native) TextToSpeech.stop().catch(() => {});
    else globalThis.speechSynthesis?.cancel();
  }
}

// Ansagen nacheinander abspielen; Fehler (keine Stimme installiert o. ä.) still ignorieren
export function say(text) {
  if (!voiceOn) return queue;
  queue = queue.then(() => voiceOn && speakNow(text)).catch(() => {});
  return queue;
}

function speakNow(text) {
  if (native) return TextToSpeech.speak({ text, lang: 'de-DE', rate: 1.05, category: 'playback' });
  if (!globalThis.speechSynthesis) return Promise.resolve();
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.onend = u.onerror = resolve;
    speechSynthesis.speak(u);
    setTimeout(resolve, 15000); // falls onend nie kommt
  });
}

export async function canListen() {
  try {
    if (native) return (await SpeechRecognition.available()).available;
  } catch { return false; }
  return !!WebRecognition;
}

// Hört einen Satz und liefert den erkannten Text (oder null)
export async function listen() {
  if (native) {
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') throw new Error('Mikrofon nicht erlaubt');
    const res = await SpeechRecognition.start({ language: 'de-DE', maxResults: 1, partialResults: false, popup: false });
    return res?.matches?.[0] || null;
  }
  return new Promise((resolve, reject) => {
    const rec = new WebRecognition();
    rec.lang = 'de-DE';
    rec.maxAlternatives = 1;
    rec.onresult = e => resolve(e.results[0][0].transcript);
    rec.onerror = e => reject(new Error(e.error));
    rec.onend = () => resolve(null);
    rec.start();
  });
}

let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (native) return on ? KeepAwake.keepAwake() : KeepAwake.allowSleep();
    if (on) wakeLock = await navigator.wakeLock?.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}
