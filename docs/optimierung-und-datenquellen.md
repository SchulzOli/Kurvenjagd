# Optimierung und Datenquellen

Wie können wir mehr Parameter in die Routensuche einbeziehen, ohne dass die Berechnung langsam wird? Und welche Datenquellen kommen dafür in Frage? Dieses Dokument beantwortet beides auf Basis echter Messwerte und schlägt eine Reihenfolge vor. Wie der heutige Algorithmus funktioniert, steht in [algorithmus.md](algorithmus.md).

Messwerte lassen sich jederzeit in der **Boxengasse** nachprüfen (7× aufs Logo tippen, siehe [Abschnitt 6](#6-die-boxengasse-als-werkzeug)).

---

## 1. Ausgangslage: Wo geht die Zeit hin?

Gemessen im Schwarzwald, Browser auf einem Desktop-PC. Werte aus der Boxengasse und einem Benchmark in Node:

| Schritt | Gebiet A (8.900 Wege, 9.100 Kanten) | Gebiet B (3.500 Wege, 3.900 Kanten) |
|---|---|---|
| Straßen laden (Overpass) | 30–55 s (je nach Auslastung) | **53,8 s** |
| Antwort lesen (JSON) | 52 ms (8,5 MB) | 13 ms (3,5 MB) |
| Netz bauen | 18 ms | 16 ms |
| Kurven vermessen | 16 ms | 20 ms |
| Punkte einrasten | 2,7 ms | 14 ms |
| Weg suchen (Dijkstra) | ~2 ms, 4 Läufe, 14.000 Knoten | 4 ms, 4 Läufe, 9.400 Knoten |
| Rundtour (8 Kandidaten) | 12 ms, 32 Läufe | – |
| Manöver ableiten | 1,5 ms | – |

**Fazit:**
- **Über 99 % der Wartezeit ist Netz.** Der eigentliche Algorithmus braucht 50–70 ms.
- Rechnerisch haben wir für die heutige Gebietsgröße **Faktor 100–1000 Luft** für zusätzliche Parameter, bevor man es spürt.
- Eng wird es an anderer Stelle: bei **größeren Gebieten** (Speicher und Ladezeit wachsen linear) und auf **schwächeren Handys** (dort ist alles etwa 3–5-mal langsamer als am PC).

Daraus folgt die Priorität: **zuerst Daten schneller und offline verfügbar machen**, dann die Rechnung so umbauen, dass beliebig viele Merkmale billig bleiben.

---

## 2. Optimierungen auf der Datenseite (größter Hebel)

| # | Maßnahme | Nutzen | Aufwand |
|---|---|---|---|
| D1 | **Overpass-Antworten in Kacheln cachen** (z. B. 0,1° × 0,1°, in IndexedDB bzw. Datei). Neue Planungen in bekannten Gebieten laden dann nichts mehr. | Wiederholte Planungen sofort, weniger Server-Last | mittel |
| D2 | **Vorberechnete Regionsdaten**: Aus Geofabrik-Extrakten (`.osm.pbf`) per Skript Graph, Kurvigkeit und alle Merkmale berechnen und als kompakte Binärdatei je Region ausliefern (z. B. „Schwarzwald“, „Alpen Ost“). Einmal herunterladen, danach komplett offline. | Unabhängig von Overpass, offline, beliebig viele Merkmale vorab | groß |
| D3 | **Eigener Overpass-Server** (Docker-Image). | Kontrollierte Verfügbarkeit, keine Fair-Use-Grenzen | mittel (plus Betrieb) |
| D4 | **Abfrage verschlanken**: Nur die Tags anfordern, die wir brauchen, und Geometrie gerundet übertragen. | 20–40 % weniger Daten | klein |
| D5 | **Kartenkacheln offline**: Vektorkacheln als PMTiles/MBTiles je Region (z. B. Protomaps), selbst gehostet. | Kartenbild auch ohne Netz | mittel |

Empfehlung: **D1 sofort** (spürbar für jeden), **D2 mittelfristig** (macht die App wirklich motorradtauglich: in den Bergen gibt es oft kein Netz).

---

## 3. Optimierungen auf der Rechenseite

### 3.1 Merkmals-Pipeline: viele Parameter, fast keine Mehrkosten

Heute ist die Kostenfunktion fest verdrahtet (Fahrzeit × Klassenfaktor × Kurvenbonus). Für viele Parameter schlage ich vor, die Arbeit in zwei Phasen zu teilen:

1. **Beim Bau des Netzes (einmal, O(Kanten))** bekommt jede Kante einen **Merkmalsvektor**: Kurvigkeit, Steigung, Belag, Breite, Ortsdurchfahrt, Ampeln, Landschaft …
2. **Bei jeder Suche** ist die Kostenfunktion nur noch eine **gewichtete Summe** (bzw. ein Produkt) dieser Merkmale. Neue Gewichte heißt nur, ein `Float64Array` neu zu füllen: ~1–3 ms für 10.000 Kanten, egal wie viele Merkmale.

```js
// Skizze: Merkmale einmal je Kante, Kosten = Fahrzeit × exp(Σ wᵢ · fᵢ)
const F = { curv: 0, grade: 1, surface: 2, urban: 3, signals: 4 };      // Spalten
const feat = new Float32Array(edges.length * 5);                       // beim Bau gefüllt
function costs(weights) {                                              // bei jeder Suche
  const out = new Float64Array(edges.length);
  for (let e = 0; e < edges.length; e++) {
    let s = 0;
    for (let k = 0; k < 5; k++) s += weights[k] * feat[e * 5 + k];
    out[e] = time[e] * Math.exp(s);
  }
  return out;
}
```

Vorteile: Parameter sind austauschbar, im Labor einzeln testbar, und später auch **lernbar** (siehe [Abschnitt 4.9](#49-eigene-daten-personalisierung)).

### 3.2 Weitere Maßnahmen

| # | Maßnahme | Nutzen | Aufwand |
|---|---|---|---|
| R1 | **Web Worker**: Netz bauen und Routen suchen in einem Hintergrund-Thread | UI ruckelt nie, auch bei großen Gebieten | klein–mittel |
| R2 | **Typed Arrays** statt Objekten: Knoten als `Float64Array`, Nachbarn als CSR (`Int32Array`), Merkmale als `Float32Array` | 3–5× weniger Speicher, schnellere Suche, schneller zu speichern | mittel |
| R3 | **Räumliches Raster fürs Einrasten** (Grid oder R-Baum) statt alle Kanten zu prüfen | Einrasten von 14 ms auf < 1 ms; wichtig für viele Stopps und Neuberechnungen unterwegs | klein |
| R4 | **Binärsuche beim Umweg-Limit** statt Schritten von 0,1 | max. 3–4 statt bis zu 9 Suchläufe | klein |
| R5 | **A\* mit Landmarken (ALT)** oder bidirektionaler Dijkstra | 2–10× schneller bei großen Gebieten (> 100.000 Kanten) | mittel |
| R6 | **Alternativrouten** (z. B. „maximal kurvig“, „ausgewogen“, „zügig“) per Strafmethode | Mehr Auswahl für den Fahrer, je Variante nur Millisekunden | klein |
| R7 | **Bessere Rundtouren**: Wegpunkte gezielt auf „Kurven-Hotspots“ legen statt auf einen Kreis, mehr Kandidaten im Worker | deutlich kurvigere Rundtouren | mittel |
| R8 | **Kurvigkeit beim Nachladen wiederverwenden** (Cache je Weg-ID) | schnelleres Nachladen | klein |

Nicht geeignet sind **Contraction Hierarchies**, wie sie OSRM nutzt: Sie setzen feste Gewichte voraus, unsere Gewichte ändern sich aber mit jeder Einstellung. „Customizable CH“ (Valhalla, GraphHopper) wäre möglich, lohnt sich aber erst bei Ländergröße.

---

## 4. Datenquellen

Status: ✅ genutzt · 🟢 empfohlen · 🟡 möglich mit Einschränkungen · 🔴 nicht nutzbar oder nicht erlaubt

### 4.1 OpenStreetMap: viel mehr, als wir heute nutzen

| Tag / Objekt | liefert | Nutzen für die Route | Status |
|---|---|---|---|
| `highway`, `name`, `ref`, `oneway`, `junction` | Straßenklasse, Name, Richtung | heutige Basis | ✅ |
| `access`, `motor_vehicle`, `motorcycle` | Zufahrtsverbote | Filter | ✅ |
| `surface`, `smoothness` | Belag (Asphalt, Schotter …), Zustand | Schotter meiden, Belag bewerten | 🟢 |
| `width`, `lanes` | Breite, Spuren | enge Bergsträßchen erkennen | 🟢 (oft lückenhaft) |
| `maxspeed` | Tempolimit | realistischere Fahrzeit; 30er-Zonen meiden | 🟢 |
| Relation `type=restriction` | Abbiegeverbote | **korrekte Routen** (fehlt heute!) | 🟢 Pflicht |
| `highway=traffic_signals`, `crossing` (Knoten) | Ampeln, Übergänge | Stop-and-go meiden | 🟢 |
| `landuse=residential`, Ortsgrenzen | Siedlungsflächen | Ortsdurchfahrten erkennen und meiden | 🟢 |
| `natural=wood`, `water`, `landuse=forest` | Landschaft | „schöne Strecke“-Bonus | 🟡 |
| `tourism=viewpoint`, `amenity=biker_cafe`/`motorcycle=yes` | Aussichtspunkte, Biker-Treffs | Stopp-Vorschläge | 🟢 |
| `toll`, `motorroad`, `bridge`, `tunnel` | Maut, Kraftfahrstraße | Filter, Hinweise | 🟢 |
| `motorcycle:conditional`, `access:conditional` | zeitliche Sperren (Wochenende, Saison) | Sperrungen für Motorräder | 🟢 |
| `route=ferry` | Fähren | als Option | 🟡 |

Bezug: wie heute über Overpass, oder offline aus **Geofabrik-Extrakten** (täglich aktualisierte `.osm.pbf` je Bundesland/Land, ODbL). Die Qualität schwankt regional; Belag und Breite fehlen oft auf kleinen Straßen.

### 4.2 Höhendaten

| Quelle | Auflösung | Zugriff | Bedingungen | Status |
|---|---|---|---|---|
| **AWS Terrain Tiles** (Mapzen, Terrarium-PNG) | ~30 m (je nach Region) | Kacheln direkt per HTTPS, im Browser dekodierbar | öffentlicher Datensatz, Quellenangabe der zugrundeliegenden DEMs | 🟢 |
| **Copernicus DEM GLO-30** | 30 m | Download (GeoTIFF) | frei mit Quellenangabe | 🟢 (für Vorberechnung D2) |
| **OpenTopoData** / **Open-Elevation** API | 30–90 m | REST | öffentliche Instanz mit Limits, selbst hostbar | 🟡 |

Nutzen: Steigung je Kante, Höhenmeter, „Passstraßen-Bonus“, realistischere Fahrzeit, Höhenprofil in der Boxengasse.

### 4.3 Wetter und Sonne

| Quelle | liefert | Bedingungen | Status |
|---|---|---|---|
| **Open-Meteo** | Regen, Temperatur, Wind stündlich, ohne API-Key | kostenlos für nicht-kommerzielle Nutzung, kommerziell kostenpflichtig | 🟢 |
| **DWD Open Data** (z. B. über Bright Sky API) | Wetter Deutschland, Radar | frei (Quellenangabe DWD) | 🟢 |
| **Sonnenstand** | tief stehende Sonne in Fahrtrichtung | reine Berechnung (SunCalc-Formeln), keine Quelle nötig | 🟢 |

Nutzen: „Regen auf Etappe 2 ab 15 Uhr“, Sonne blendet auf der Westrampe, Startzeit-Empfehlung.

### 4.4 Sperrungen, Baustellen, Verkehr

| Quelle | liefert | Einschränkung | Status |
|---|---|---|---|
| **Autobahn-API des Bundes** | Baustellen, Sperrungen | nur Autobahnen, für uns kaum relevant | 🟡 |
| **Mobilithek** (DATEX II) | Baustellen einzelner Bundesländer | uneinheitlich, nicht flächendeckend | 🟡 |
| Pass-Status (Alpenpässe) | Wintersperren | meist Webseiten ohne API | 🟡 (manuell gepflegte Liste) |
| TomTom, HERE Traffic | Live-Verkehr | kostenpflichtig | 🟡 |

Eine freie, flächendeckende Quelle für Sperrungen auf Landstraßen gibt es in Deutschland nicht.

### 4.5 Geocoding (Ortssuche)

| Quelle | Status | Hinweis |
|---|---|---|
| **Photon** (komoot) | ✅ | Fair Use; selbst hostbar |
| **Nominatim** (OSM) | 🟡 | Policy: max. 1 Anfrage/Sekunde, kein Autocomplete |

### 4.6 Kartenkacheln

| Quelle | Status | Hinweis |
|---|---|---|
| tile.openstreetmap.org | ✅ (nur Prototyp) | Nutzungsrichtlinie verbietet stark genutzte Apps |
| OpenTopoMap | ✅ | Fair Use |
| MapTiler, Stadia, Thunderforest | 🟢 | kostenlos bis zu einem Kontingent, dann kostenpflichtig |
| **PMTiles / Protomaps, selbst gehostet** | 🟢 | offline-fähig, einmalige Erstellung je Region |

### 4.7 Andere Routing-Engines (Vergleich und Ideen)

| Engine | interessant, weil | Status |
|---|---|---|
| **GraphHopper** | hat eine eingebaute `curvature`-Kennzahl und frei definierbare Profile („Custom Models“) | 🟢 als Referenz/Benchmark |
| **Valhalla** | eigenes Motorrad-Profil (Autobahn/Maut/Schotter meiden) | 🟢 als Referenz |
| OSRM | sehr schnell, aber feste Gewichte | 🟡 |
| openrouteservice | gehostete API mit Kontingent | 🟡 |

Damit können wir unsere Routen gegen etablierte Engines vergleichen und Ideen übernehmen.

### 4.8 Vorberechnete Kurvigkeit

| Quelle | Status | Hinweis |
|---|---|---|
| **roadcurvature.com** (Adam Franco) | 🟡 | Kurvigkeit je Straße für viele Länder als KML/KMZ, sehr gut zum **Kalibrieren** unserer Werte. Lizenz vor Nutzung prüfen. |

### 4.9 Eigene Daten (Personalisierung)

- **Gefahrene Touren** (GPS-Spur, Tempo in Kurven) und eine **Bewertung nach der Fahrt** („hat Spaß gemacht“, 1–5).
- Daraus lassen sich die Gewichte der Merkmals-Pipeline ([3.1](#31-merkmals-pipeline-viele-parameter-fast-keine-mehrkosten)) **pro Fahrer anpassen**: der eine liebt Spitzkehren, die andere flotte Bögen.
- Bleibt komplett auf dem Gerät (Datenschutz).

**Umgesetzt in Phase 6** ([src/profile.js](../src/profile.js), [src/profile-ui.js](../src/profile-ui.js)). Details zum Lernverfahren: [algorithmus.md, Abschnitt 11.1](algorithmus.md#111-persönliches-fahrprofil).

### 4.10 Nicht nutzbar

| Quelle | Grund |
|---|---|
| Google Maps / Directions | Nutzungsbedingungen verbieten Speichern und Kombinieren mit anderen Karten |
| Strava Heatmap | Nutzungsbedingungen, kein offenes API |
| Kurviger, calimoto, Rever | kein offenes API |
| Blitzer-/Radarwarner-Daten | In Deutschland ist das Benutzen von Warnfunktionen während der Fahrt verboten (§ 23 Abs. 1c StVO) |

---

## 5. Empfohlene Reihenfolge

**Alle sechs Phasen sind umgesetzt** (siehe Tabelle unten).

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 1 ✅ | D1 Overpass-Kachel-Cache, R1 Web Worker, R3 Einrasten per Raster, R4 Binärsuche | **erledigt**: gleiche Planung nach Neustart 0,26 s (Browser) bzw. 0,75 s (Android) statt 21–58 s; erste Planung nur noch eine Overpass-Anfrage; Einrasten ~7× schneller; Umweg-Suche max. 5 statt 9 Läufe; Rechnen im Web Worker (auch auf Android) |
| 2 ✅ | 3.1 Merkmals-Pipeline + R2 Typed Arrays | **erledigt**: 7 Merkmale aus OSM-Tags (Belag, Kopfsteinpflaster, Zustand, Tempolimit, Breite, Tunnel, Maut) mit Gewichten im Labor; Datenabdeckung in der Boxengasse; Kostenberechnung −65 bis −74 %, Suche −28 bis −41 %, Route gesamt −40 bis −45 % bei identischen Ergebnissen; Nachbarschaften als CSR |
| 3 ✅ | Abbiegeverbote, `surface`/`smoothness`, `maxspeed`, Ortsdurchfahrten, Höhendaten | **erledigt**: Abbiegeverbote (Schwarzwald: 1.091 an 964 Kreuzungen, eine Testroute dadurch korrigiert), zweistufige Suche ohne Geschwindigkeitsverlust; Höhenmodell aus AWS Terrain Tiles parallel zu Overpass (1,5 s, gecacht) mit Anstieg/Gefälle, Höhenprofil und den Merkmalen „steil“ und „bergig“; Belag, Zustand und Tempolimit seit Phase 2. Offen: Verbote mit Via-Weg, eigene Erkennung von Ortsdurchfahrten über Siedlungsflächen |
| 4 ✅ | D2 vorberechnete Regionen + D5 Offline-Karten | **erledigt**, aber ohne eigenen Server: Offline-Regionen werden auf dem Gerät aus Overpass + Höhenmodell + Ortsnamen gebaut und angepinnt (8 Voreinstellungen oder Kartenausschnitt, blockweise, fortsetzbar). Statt fremder Kartenkacheln (Vorab-Download verboten) zeichnet die App eine eigene Offline-Karte (Straßen, Schummerung, Ortsnamen). Offline planen, navigieren und neu berechnen funktioniert im Gebiet. Offen: serverseitiger Bau aus Geofabrik für schnellere Downloads, Wasser/Wald in der Offline-Karte |
| 5 ✅ | Wetter, Sonnenstand, Alternativrouten (R6) | **erledigt**: Wetter entlang der Route für eine wählbare Abfahrtszeit (Open-Meteo, eine Abfrage für bis zu 12 Punkte) mit Warnungen; Sonnenstand selbst berechnet mit Blend- und Dunkelheitswarnungen, Live-Blendwarnung in der Fahrt; zwei Alternativen (eigenständige zweite Variante per Strafmethode, zügige Route) zum Vergleichen und Wählen |
| 6 ✅ | Personalisierung aus eigenen Fahrten | **erledigt**: Fahrten werden aufgezeichnet (gefahrene Abschnitte auch über Neuberechnungen, GPS-Spur, Tempo in Kurven/auf Geraden), danach Bewertung mit 1–5 Sternen und 9 Schnell-Tags. Tags wirken sofort; aus Sternen lernt eine gedämpfte Regression je Strecken-Eigenschaft (Kurvenarten, Merkmale, Straßenklassen) ab 3 Bewertungen. Anpassungen begrenzt und in Klartext begründet, abschaltbar und zurücksetzbar, alles auf dem Gerät. Reiter „Fahrten“ in der Bibliothek (Spur zeigen, GPX), Boxengasse „Profil“. Offen: Kurventempo als eigenes Lernsignal, Profile pro Motorrad/Fahrer |

---

## 6. Die Boxengasse als Werkzeug

Die Boxengasse ist bewusst als Startpunkt für diese Arbeit gebaut:

- **Überblick:** Echte Zeiten jeder Pipeline-Stufe. Jede Optimierung muss sich hier zeigen.
- **Route / Netz:** Kurvenprofil, Kurven-Mix, Straßenarten und Kurvigkeits-Verteilung. Damit lassen sich neue Merkmale sichtbar prüfen.
- **Labor:** Alle Parameter (`P` in [src/router.js](../src/router.js)) live verändern und die Wirkung auf die aktuelle Route vergleichen. Neue Merkmale aus der Pipeline bekommen hier ihre Regler.
- **Fahrt:** Live-GPS, Abstand zur Route, Manöver und Ansage-Stufen, um Navigationsfehler unterwegs zu finden.
- **System / Log:** Dienst-Status (Overpass, Photon, Kacheln), Ereignisse, „Diagnose kopieren“ als JSON für Fehlerberichte.

Neue Messpunkte gehören in `metrics` ([src/router.js](../src/router.js)) bzw. in `telemetry` ([src/telemetry.js](../src/telemetry.js)) und lassen sich dann in einem eigenen Bereich der Boxengasse anzeigen.
