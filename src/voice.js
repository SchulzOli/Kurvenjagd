// Deutsche Sprachbefehle während der Fahrt -> Aktion. Reihenfolge der Regeln ist wichtig:
// spezifische Befehle ("Halt überspringen", "Stopp Tankstelle") vor allgemeinen ("Stopp in …").

export const COMMANDS = [
  '„Zwischenstopp in Todtnau“',
  '„Tankstelle“ oder „Pause“ / „Café“',
  '„Nächster Halt“ / „Wie weit noch?“',
  '„Halt überspringen“',
  '„Kurviger“ / „Weniger kurvig“',
  '„Wiederholen“',
  '„Navigation beenden“',
];

const RULES = [
  [/\b(hilfe|was kann ich sagen|befehle)\b/, () => ({ type: 'help' })],
  [/boxengasse|telemetrie/, () => ({ type: 'box' })],
  [/\b(navigation|fahrt|route|tour)\s+(beenden|stoppen|abbrechen)\b|^(beenden|ende|abbrechen)$/, () => ({ type: 'end' })],
  [/wiederhol|nochmal|noch mal|was war das/, () => ({ type: 'repeat' })],
  [/überspring|auslassen|streichen/, () => ({ type: 'skip' })],
  [/tank(e|stelle|en)?\b|sprit|benzin/, () => ({ type: 'poi', poi: 'fuel' })],
  [/caf[eé]|kaffee|pause|rast\b|rasten|essen|restaurant|imbiss|biergarten/, () => ({ type: 'poi', poi: 'food' })],
  [/nächste[rnms]?\s+(halt|stopp|haltestelle|zwischenstopp|ziel)|wie weit|wie lange|wann (bin ich|sind wir) da|restzeit|entfernung/, () => ({ type: 'status' })],
  [/kurviger|mehr kurven/, () => ({ type: 'curvy', delta: 0.2 })],
  [/weniger kurv|gerader|direkter|schneller/, () => ({ type: 'curvy', delta: -0.2 })],
  [/(?:zwischen)?(?:stopp|halt|zwischenhalt)\s+(?:in|bei|nach|an|am|im|auf)?\s*(.+)$/, m => ({ type: 'addPlace', place: m[1] })],
  [/(?:fahr(?:e)?|fahre?n?)\s+(?:über|via)\s+(.+)$|(?:füge?|nimm)\s+(.+?)\s+(?:hinzu|mit|dazu)$/, m => ({ type: 'addPlace', place: m[1] || m[2] })],
];

export function parseCommand(text) {
  const t = text.toLowerCase().trim().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ');
  for (const [re, make] of RULES) {
    const m = t.match(re);
    if (m) {
      const cmd = make(m);
      if (cmd.place) cmd.place = cmd.place.replace(/\s+(hinzufügen|hinzu|bitte)$/, '').trim();
      return cmd;
    }
  }
  return { type: 'unknown', text: t };
}
