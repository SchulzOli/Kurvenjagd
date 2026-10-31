// Merkmale je Straßenabschnitt, abgeleitet aus OSM-Tags. Jeder Wert liegt zwischen 0 und 1;
// fehlt das Tag, ist der Wert 0 (neutral) – fehlende Daten verändern die Route also nicht.
//
// Ein neues Merkmal hinzufügen:
//   1. hier eintragen (key, Bezeichnung, benötigte Tags, Berechnung),
//   2. Standardgewicht in P.weights (router.js) setzen.
// Alles andere (Speichern, Kosten, Labor, Statistik in der Boxengasse) passiert automatisch.
//
// Wirkung auf die Kosten: Kosten × (1 + Gewicht × Wert). Positives Gewicht = meiden, negatives = bevorzugen.

const UNPAVED = /^(unpaved|gravel|fine_gravel|compacted|dirt|earth|ground|grass|grass_paver|sand|mud|pebblestone|rock|woodchips)$/;
const COBBLE = /^(sett|cobblestone|unhewn_cobblestone|paving_stones)$/;
const SMOOTHNESS = { intermediate: 0.3, bad: 0.7, very_bad: 1, horrible: 1, very_horrible: 1, impassable: 1 };

function speedLimit(v) {
  if (!v) return 0;
  if (/urban|zone|walk|living_street/.test(v)) return 1;  // z. B. DE:urban = innerorts
  const n = parseInt(v, 10);
  return n && n <= 50 ? 1 : 0;
}

export const FEATURES = [
  { key: 'unpaved', label: 'Unbefestigt (Schotter, Erde …)', tags: ['surface'], value: t => (UNPAVED.test(t.surface || '') ? 1 : 0) },
  { key: 'cobble', label: 'Kopfsteinpflaster', tags: ['surface'], value: t => (COBBLE.test(t.surface || '') ? 1 : 0) },
  { key: 'rough', label: 'Schlechter Straßenzustand', tags: ['smoothness'], value: t => SMOOTHNESS[t.smoothness] || 0 },
  { key: 'slow', label: 'Tempolimit ≤ 50 (meist innerorts)', tags: ['maxspeed'], value: t => speedLimit(t.maxspeed) },
  { key: 'narrow', label: 'Schmal (einspurig oder unter 4 m)', tags: ['width', 'lanes'],
    value: t => ((t.lanes === '1' && t.oneway !== 'yes') || parseFloat(t.width) < 4 ? 1 : 0) },
  // implicit: Tag wird in OSM nur gesetzt, wenn es zutrifft – eine Datenabdeckung lässt sich dafür nicht angeben
  { key: 'tunnel', label: 'Tunnel', tags: ['tunnel'], implicit: true, value: t => (t.tunnel && t.tunnel !== 'no' ? 1 : 0) },
  { key: 'toll', label: 'Mautpflichtig', tags: ['toll'], implicit: true, value: t => (t.toll === 'yes' ? 1 : 0) },
  // Aus dem Höhenmodell statt aus Tags (dem.js): Werte setzt der Netzaufbau, wenn Höhendaten geladen sind.
  // Positives Gewicht meidet sie, negatives sucht gezielt Bergstrecken.
  { key: 'steep', label: 'Steil (Anteil mit über 8 % Steigung)', tags: [], source: 'dem', value: () => 0 },
  { key: 'hilly', label: 'Bergig (Höhenmeter je km, ab 60 voll)', tags: [], source: 'dem', value: () => 0 },
];

export const FEATURE_TAGS = [...new Set(FEATURES.flatMap(f => f.tags))];

// Werte aller Merkmale für einen Weg + Bitmaske, welche Merkmale überhaupt Daten hatten (für die Datenabdeckung)
export function featureRow(tags = {}) {
  const values = new Float64Array(FEATURES.length);
  let known = 0;
  FEATURES.forEach((f, i) => {
    values[i] = f.value(tags);
    if (f.tags.some(t => tags[t] != null)) known |= 1 << i; // Höhen-Merkmale setzt der Netzaufbau
  });
  return { values, known };
}
