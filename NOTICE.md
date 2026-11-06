# Lizenzen und Quellenangaben

## Kurvenjagd

Copyright © 2026 SchulzOli und die Mitwirkenden des Projekts.

Der Quellcode steht unter der **GNU General Public License v3.0 oder später** (siehe [LICENSE](LICENSE)). Du darfst ihn nutzen, verändern und weitergeben, auch in eigenen Apps, solange diese wieder unter der GPL mit Quellcode veröffentlicht werden.

## Daten

| Quelle | Wofür | Lizenz / Pflicht |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Straßen, Namen, Abbiegeverbote, Orte, Tankstellen; Grundlage der Straßenpakete und der Vektorkarte | **ODbL 1.0**: „© OpenStreetMap-Mitwirkende“. Die daraus gebauten Straßenpakete und die Kartendatei sind abgeleitete Datenbanken und stehen ebenfalls unter der ODbL. |
| [Geofabrik](https://download.geofabrik.de/) | OSM-Auszug Deutschland/Österreich/Schweiz für den wöchentlichen Bau | Daten: ODbL (OpenStreetMap) |
| [Protomaps Basemaps](https://github.com/protomaps/basemaps) | Kartenschema und Farbvorlagen der Vektorkarte | Code: BSD-3-Clause; Kartendaten: ODbL (OpenStreetMap) |
| [Mapzen Terrain Tiles auf AWS](https://registry.opendata.aws/terrain-tiles/) | Höhenmodell (Anstieg, Steigung, Schummerung) | Quellenangabe der Höhendaten nötig, u. a. SRTM, EU-DEM (Copernicus), GMTED2010, ETOPO1 – vollständige Liste: [Attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| [Open-Meteo](https://open-meteo.com/) | Wettervorhersage entlang der Route | **CC BY 4.0**, Nennung „Open-Meteo“; frei für nicht-kommerzielle Nutzung |
| [Photon](https://photon.komoot.io/) von komoot | Ortssuche und Ortsnamen | Dienst „in vernünftigem Rahmen“; Daten: ODbL (OpenStreetMap) |

In der App stehen diese Angaben in der Karten-Ecke und unter „Weitere Einstellungen und Details“.

## Bibliotheken

| Paket | Lizenz |
|---|---|
| Leaflet | BSD-2-Clause |
| protomaps-leaflet, pmtiles, @protomaps/basemaps | BSD-3-Clause |
| fflate | MIT |
| Capacitor (@capacitor/*) und Capacitor-Community-Plugins | MIT |
| cordova-plugin-purchase | MIT |
| esbuild, @capacitor/assets, @capacitor/cli (nur beim Bauen) | MIT |
| pyosmium (nur beim Datenbau) | BSD-2-Clause |

Die genauen Versionen stehen in [package-lock.json](package-lock.json).
