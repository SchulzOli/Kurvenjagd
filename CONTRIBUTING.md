# Mitmachen

Schön, dass du helfen willst! Kurvenjagd ist ein Freizeitprojekt: kostenlos für alle, ohne Werbung und ohne bezahlte Funktionen. Jede Hilfe zählt – Fehlerberichte, Ideen, Code, Tests auf echten Touren oder Übersetzungen.

## Fehler melden und Ideen einbringen

- **Fehler:** [Issue „Fehler melden“](../../issues/new/choose) mit Gerät, App-Version und was du erwartet hast. Sehr hilfreich: in der App die **Boxengasse** öffnen (7× auf das Logo tippen) → System → „Diagnose kopieren“ und den Text anhängen. Sie enthält keine Standorte.
- **Komische Route?** Bitte Start, Ziel und Einstellungen angeben (oder die GPX-Datei). Oft liegt es an den OpenStreetMap-Daten – dann hilft eine Korrektur direkt auf [openstreetmap.org](https://www.openstreetmap.org/) allen.
- **Ideen:** [Issue „Idee“](../../issues/new/choose). Bitte zuerst schauen, ob es sie schon gibt.
- **Sicherheitslücken** nicht öffentlich melden, sondern wie in [SECURITY.md](SECURITY.md) beschrieben.

## Entwickeln

Voraussetzungen: Node.js 22+, für den Datenbau Python 3.12+ mit `pip install osmium`, für Android das Android SDK (siehe [README](README.md#android-app-bauen)).

```bash
npm ci
npm run build
npm test
node scripts/serve.mjs     # http://localhost:8765
```

Für echte Straßen ein Testgebiet bauen (Anleitung im [README](README.md#daten-straßenpakete-und-karte)). Ohne Testdaten fällt die Entwicklungs-Version auf die öffentlichen Overpass-Server zurück.

Wie der Algorithmus funktioniert, steht in [docs/algorithmus.md](docs/algorithmus.md). Die **Boxengasse** zeigt Messwerte und hat ein Parameter-Labor zum Ausprobieren.

## Pull Requests

1. Für größere Änderungen bitte erst ein Issue aufmachen, damit wir uns abstimmen können.
2. Einen Branch vom aktuellen `main` anlegen und die Änderung möglichst klein halten.
3. `npm test` muss grün sein; neue Logik bekommt Tests (Muster: `*.test.mjs` im Hauptordner, Node-Testrunner).
4. Code-Stil wie im übrigen Code: modernes JavaScript (ES-Module), keine Frameworks, **Kommentare und Oberflächentexte auf Deutsch**, Kommentare erklären das Warum.
5. Ändert sich ein Verhalten, auch die passende Doku (`README.md`, `docs/`) anpassen.
6. Mit dem Pull Request stimmst du zu, dass dein Beitrag unter der [GPL-3.0](LICENSE) veröffentlicht wird.

## Grundsätze

- **Alles bleibt auf dem Gerät:** keine Konten, kein Tracking, keine Analyse-Dienste. Fahrten und Profil verlassen das Handy nicht.
- **Keine Funktionen gegen Geld.** Unterstützung ist freiwillig („zahl, was du willst“).
- **Offen und erklärbar:** Wie eine Route entsteht, soll nachvollziehbar bleiben (Boxengasse, Doku).
- **Fremde Dienste fair nutzen:** Nutzungsregeln von OpenStreetMap, Photon, Open-Meteo und Co. einhalten.

Für den Umgang miteinander gilt der [Verhaltenskodex](CODE_OF_CONDUCT.md).
