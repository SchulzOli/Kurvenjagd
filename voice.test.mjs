// node --test   (Sprachbefehle)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from './src/voice.js';

const cases = [
  ['Zwischenstopp in Todtnau', { type: 'addPlace', place: 'todtnau' }],
  ['Stopp bei Titisee-Neustadt bitte', { type: 'addPlace', place: 'titisee-neustadt' }],
  ['Fahr über Sankt Märgen', { type: 'addPlace', place: 'sankt märgen' }],
  ['Neuer Stopp Tankstelle', { type: 'poi', poi: 'fuel' }],
  ['Ich muss tanken', { type: 'poi', poi: 'fuel' }],
  ['Zeit für eine Pause', { type: 'poi', poi: 'food' }],
  ['Nächster Halt', { type: 'status' }],
  ['Nächste Haltestelle?', { type: 'status' }],
  ['Wie weit noch', { type: 'status' }],
  ['Nächsten Halt überspringen', { type: 'skip' }],
  ['Kurviger', { type: 'curvy', delta: 0.2 }],
  ['Weniger kurvig bitte', { type: 'curvy', delta: -0.2 }],
  ['Navigation beenden', { type: 'end' }],
  ['Wiederholen', { type: 'repeat' }],
  ['Hilfe', { type: 'help' }],
  ['Boxengasse öffnen', { type: 'box' }],
];
for (const [say, want] of cases) test(`„${say}“`, () => assert.deepEqual(parseCommand(say), want));

test('unbekannter Satz', () => assert.equal(parseCommand('Wie wird das Wetter').type, 'unknown'));
