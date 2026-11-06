# Finanzierung und Betrieb

Grundsatz: **Kurvenjagd ist für alle kostenlos und Open Source.** Es gibt keine bezahlten Funktionen, keine Werbung und kein Konto. Wer mag, gibt einen frei gewählten Betrag („zahl, was du willst“). Das Spendenziel ist genau das, was der Betrieb kostet, plus ein Puffer.

Stand der Preise und Regeln: November 2026. Betrieb auf dem vorhandenen Hetzner-Cloud-Server unter `kurvenjagd.oli-tech.eu` (Einrichtung: [server/README.md](../server/README.md)). Alle Beträge sind grobe Schätzungen; vor dem Start bei den Anbietern prüfen.

---

## 1. Brauchen wir einen Server?

**Kurz: keinen klassischen Server, aber eigene Dateien im Netz.** Routing, Navigation, Fahrprofil und Offline-Karte laufen auf dem Handy. Was vorher fremde Dienste erledigten, ist ersetzt bzw. vorbereitet (✅ = umgesetzt):

| Vorher | Problem bei einer öffentlichen App | Ersatz | Server nötig? |
|---|---|---|---|
| Kartenbild von `tile.openstreetmap.org` | Verteilen einer App, die diese Kacheln lädt, ist ohne Erlaubnis verboten, Offline-Downloads ebenfalls | ✅ Eigene Vektorkarte als **eine PMTiles-Datei** (Protomaps, Open Source) für D-A-CH auf dem eigenen Server, hell/dunkel, Geländeschattierung aus dem Höhenmodell statt OpenTopoMap | nur Webserver für Dateien |
| Straßendaten von Overpass (öffentliche Server) | Betreiber (FOSSGIS) erlaubt keine Dienste mit viel Verkehr; Server-Adressen sollen nicht fest in Apps stehen | ✅ **Vorgebaute Straßenpakete** je 0,1°-Kachel, wöchentlich aus dem Geofabrik-Auszug gebaut ([scripts/build_data.py](../scripts/build_data.py), [.github/workflows/daten.yml](../.github/workflows/daten.yml)) | nein: Bau per GitHub Actions, Ablage auf dem eigenen Server |
| Tankstellen/Cafés per Overpass | wie oben | ✅ In die Straßenpakete aufgenommen (funktioniert damit auch offline) | nein |
| Ortssuche über `photon.komoot.io` | erlaubt „in vernünftigem Rahmen“, viel Verkehr wird gedrosselt oder gesperrt | anfangs komoot, später **eigene Photon-Instanz** nur für D-A-CH (Adresse per `KJ_GEOCODER_URL` umstellbar ✅) | ab ca. 5.000 Nutzern |
| Wetter über Open-Meteo (frei) | frei nur nicht-kommerziell; ob eine spendenfinanzierte App zählt, ist offen | **Bei Open-Meteo nachfragen** ([Entwurf der Anfrage](anfrage-open-meteo.md)); sonst bezahlter Tarif (`KJ_WEATHER_URL` ✅) oder Open-Meteo selbst betreiben (Open Source) | nein |
| Höhenmodell AWS Terrain Tiles | kostenlos (Open-Data-Programm von AWS) | bleibt | nein |

Damit besteht der Betrieb aus:
- dem **eigenen Hetzner-Cloud-Server** als Webserver für Website, Karte und Straßenpakete (20 TB Traffic im Monat inklusive; ein vorhandener Server kostet nichts extra),
- einem **wöchentlichen Bau-Job** (GitHub Actions, kostenlos für öffentliche Repos),
- ab einer gewissen Größe **einem kleinen Server** für die Ortssuche,
- **Entwicklerkonten** der Stores.

---

## 2. Kosten pro Monat

### Annahmen

- Ein aktiver Nutzer im Monat plant ~4 Touren und fährt ~2: ca. **1.200 Dateiabrufe** (Kartenkacheln + Straßenpakete), auf dem Gerät 7–30 Tage gecacht.
- Auslieferung vom eigenen Hetzner-Cloud-Server: im Schnitt ~15 KB je Abruf → ~18 MB je Nutzer und Monat; 100.000 Nutzer ≈ 1,8 TB von 20 TB inklusive. Ein vorhandener Server kostet nichts extra; ein eigener nur dafür ca. 5,50 €/Monat (CX23).
- Platz (gemessen 10/2026): Karte D-A-CH bis Zoom 14 4,9 GB, Straßenpakete ≈ 0,8 GB, beim Umschalten kurz doppelt. Beta Baden-Württemberg: 0,47 GB + 59 MB.
- Domain: `oli-tech.eu` ist vorhanden, Subdomain kostet nichts.
- Ortssuche: bis 5.000 Nutzer komoot; danach Server mit 16 GB RAM (~20 €, nach den Hetzner-Preiserhöhungen 2026); ab 50.000 Nutzer größer oder zwei (~40 €).
- Wetter: ~6 Abfragen je Nutzer und Monat (eine Abfrage deckt die ganze Route). Bezahlter Open-Meteo-Tarif nur falls nötig, ca. 29 €/Monat (bis 1 Mio. Abfragen).
- Fix: Apple-Entwicklerkonto 99 $/Jahr (~7,50 €/Monat) – erst ab iOS (Stufe 3). Google Play einmalig 25 $, F-Droid kostenlos.

### Ergebnis

| Aktive Nutzer/Monat | Apple (ab iOS) | Server | Ortssuche | Summe | mit Wetter-Tarif |
|---:|---:|---:|---:|---:|---:|
| Beta (Android) | – | 0 € | 0 € | **0 €** (+ 25 $ Google Play einmalig) | ~30 € |
| 1.000 | 7,50 € | 0 € | 0 € | **7,50 €** | ~37 € |
| 5.000 | 7,50 € | 0 € | 0 € | **7,50 €** | ~37 € |
| 10.000 | 7,50 € | 0 € | 20 € | **27,50 €** | ~57 € |
| 50.000 | 7,50 € | 0 € (≈ 0,9 TB) | 20 € | **27,50 €** | ~57 € |
| 100.000 | 7,50 € | 0 € (≈ 1,8 TB) | 40 € | **47,50 €** | ~77 € |

„Server 0 €“ gilt für den vorhandenen Hetzner-Server; ein eigener Server nur für Kurvenjagd kostet ca. 5,50 €/Monat mehr.

Nicht enthalten: Arbeitszeit, Werbung für die App, Steuerberatung.

### Spendenziel

**Spendenziel = Betriebskosten × 1,1 (Zahlungsgebühren) × 1,2 (Rücklage), auf 5 € aufgerundet.**

| Aktive Nutzer | Spendenziel/Monat | mit Wetter-Tarif | Bei 3 € je Spende nötig |
|---:|---:|---:|---:|
| Beta (Android) | **5 €** (Google-Play-Gebühr aufs erste Jahr verteilt + Rücklage) | 40 € | 2 Unterstützer |
| 1.000 | **10 €** | 50 € | 4 (0,4 %) |
| 5.000 | **10 €** | 50 € | 4 (0,08 %) |
| 10.000 | **40 €** | 80 € | 14 (0,14 %) |
| 50.000 | **40 €** | 80 € | 14 (0,03 %) |
| 100.000 | **65 €** | 105 € | 22 (0,02 %) |

Die Kosten wachsen deutlich langsamer als die Nutzerzahl, weil fast alles auf dem Gerät gerechnet wird. Schon wenn einer von 500 Nutzern ein paar Euro im Monat gibt, ist der Betrieb bezahlt.

Für die App: Das aktuelle Ziel und der Stand stehen öffentlich in einer kleinen JSON-Datei auf dem eigenen Server (`spendenziel.json`: Ziel, eingegangen, Monat). Die App zeigt daraus einen Fortschrittsbalken unter „Unterstützen“. Monatlich von Hand aktualisieren; ein Konto oder Tracking braucht es nicht.

---

## 3. Unterstützungsmodelle

Keine Funktionen gegen Geld, also auch keine „Pro“-Version und keine Vorteile für Unterstützer. Sinnvoll sind:

| Modell | Wie | Passt, weil |
|---|---|---|
| **Einmalig, frei wählbar** | Spender wählt den Betrag | einfachster Einstieg |
| **Regelmäßig, frei wählbar** (wöchentlich/monatlich/jährlich) | Liberapay, GitHub Sponsors, Dauerauftrag | planbare Einnahmen für die laufenden Kosten |
| **Spendenziel mit Balken** | Monatsziel aus Abschnitt 2, öffentlich | macht die Kosten nachvollziehbar, nimmt den Druck raus, „genug“ geben zu müssen |
| ~~Freemium, Werbung, Abo für Funktionen~~ | – | widerspricht dem Grundsatz |

---

## 4. Zahlungswege

| Weg | Open Source | Gebühr Plattform | Zahlungsarten | Bemerkung |
|---|---|---|---|---|
| **Liberapay** | ja (gemeinnütziger Verein, Frankreich) | 0 %, nur die des Zahlungsanbieters | Karte, SEPA-Lastschrift, PayPal | für „zahl, was du willst“ gebaut; regelmäßige Spenden. **Erste Wahl** |
| **GitHub Sponsors** | nein | 0 % für persönliche Konten | Karte, PayPal | passt, wenn der Code auf GitHub liegt; einmalig oder monatlich, eigener Betrag |
| **Open Collective** (Host z. B. Open Collective Europe) | Plattform ja | Host meist 10 % + Zahlungsgebühren | Karte, PayPal, Überweisung | öffentlicher Haushalt (jede Ausgabe sichtbar); lohnt, wenn mehrere mitarbeiten |
| **SEPA-Überweisung / Dauerauftrag** | – | 0 € | Überweisung | billigster Weg; IBAN und Name sind dann öffentlich |
| **Ko-fi** | nein | 0 % auf Einmalspenden, 5 % auf Mitgliedschaften (Gratis-Tarif) | PayPal, Karte | Alternative, wenn Liberapay nicht reicht |
| **Patreon, Buy Me a Coffee, Steady** | nein | ca. 5–12 % | – | teurer, auf Vorteile für Unterstützer ausgelegt; nicht empfohlen |
| **In-App-Kauf im Store** | – | 15 % (Programme für kleine Entwickler bei Google und Apple) | Store-Konto | in Store-Apps praktisch Pflicht, siehe unten |

### Die Stolperfalle: App-Stores

- **Google Play:** Apps wurden mehrfach wegen eines Spenden-Links entfernt (WireGuard 2019, Language Transfer 2021, StreetComplete, AnkiDroid 2026). Ausnahme sind steuerbegünstigte Spenden an gemeinnützige Organisationen.
- **Apple:** Trinkgeld an den Entwickler muss per In-App-Kauf laufen; Links zu externen Zahlungen nur mit Sonderregeln und eigenen Gebühren (EU: neue Bedingungen seit 1. Oktober 2026).

Daher pro Vertriebsweg:

| Vertriebsweg | Unterstützen über |
|---|---|
| **F-Droid** (Open-Source-Store, kennt Spenden-Felder wie Liberapay direkt) | Liberapay, GitHub Sponsors, Überweisung, direkt in der App verlinkt |
| **Web-App / Website** | dasselbe |
| **Google Play, App Store** | „Trinkgeld“ als In-App-Kauf in Stufen (z. B. 2, 5, 10, 25 €, einmalig oder monatlich), schaltet nichts frei. Technik: `cordova-plugin-purchase` (Open Source, läuft mit Capacitor). Kein externer Spenden-Link in diesen Versionen |

Die App-Version erkennt ihren Vertriebsweg beim Bauen (Build-Variable) und zeigt den passenden Bildschirm.

---

### Umsetzung in der App ✅

Code: [src/support.js](../src/support.js). Erreichbar über „♥ Kurvenjagd unterstützen“ in den Einstellungen und in der Bibliothek, dazu einmalig ein Hinweis nach der fünften gespeicherten Fahrt. Nichts wird freigeschaltet.

- **Vertriebsweg** beim Bauen: `KJ_CHANNEL=web | fdroid | store` (ohne Angabe: nativ `store`, Browser `web`).
- **`store`** (Google Play, App Store): nur Trinkgeld-Knöpfe per In-App-Kauf über `cordova-plugin-purchase`, **keine externen Links**. Verbrauchsprodukte `trinkgeld_2`, `trinkgeld_5`, `trinkgeld_10`, `trinkgeld_25` in der Play Console bzw. App Store Connect anlegen (Preise z. B. 1,99 / 4,99 / 9,99 / 24,99 €). Kauf wird sofort abgeschlossen, keine Belegprüfung nötig. Nur Google Play zusätzlich: Abo `unterstuetzer_monatlich` (z. B. 1,99 €/Monat, jederzeit kündbar) – bei Apple nicht, weil Abos dort einen fortlaufenden Gegenwert bieten müssen. Ohne angelegte Produkte oder außerhalb des Stores zeigt die App „gerade nicht verfügbar“.
- **`web`, `fdroid`:** Links aus `spendenziel.json`.
- **`spendenziel.json`** auf dem Datenspeicher (Beispiel: `data/spendenziel.json`), monatlich von Hand: `monat`, `ziel`, `eingegangen` (alle Wege zusammen, Store-Einnahmen aus den Konsolen), `kosten` als Liste `[Bezeichnung, Euro]`, `links` (`liberapay`, `github`, `iban`, `inhaber`). Änderungen wirken ohne App-Update.

## 5. Recht und Steuern (nur Hinweise, keine Beratung)

- **Spenden an eine Privatperson sind steuerpflichtige Einnahmen** und für Spender nicht absetzbar. Eine Spendenquittung kann nur ein gemeinnütziger Verein ausstellen; das lohnt sich erst bei größeren Beträgen.
- Bei regelmäßigen Einnahmen: freiberufliche bzw. gewerbliche Tätigkeit anmelden, Kleinunternehmerregelung prüfen.
- Store-Einnahmen (In-App-Trinkgeld) zählen genauso.
- Lizenzen: App-Code z. B. GPL-3.0; Karten- und Straßenpakete sind von OpenStreetMap abgeleitet und stehen unter der ODbL (Namensnennung „© OpenStreetMap-Mitwirkende“, abgeleitete Datenbanken unter derselben Lizenz). Open-Meteo-Daten: CC BY 4.0.

---

## 6. Reihenfolge

1. **Vor der Veröffentlichung (Pflicht):** ✅ Kartenbild auf eigene PMTiles umgestellt, ✅ Straßenpakete statt Overpass. Offen: Server nach [server/README.md](../server/README.md) einrichten (Subdomain, nginx, Zugang für die Workflows), Open-Meteo anfragen, Release bauen (zeigt automatisch auf `kurvenjagd.oli-tech.eu`).
2. Liberapay-Konto, „Unterstützen“-Bildschirm mit Spendenziel aus `spendenziel.json`, F-Droid-Eintrag.
3. Store-Versionen mit In-App-Trinkgeld.
4. Ab ~5.000 aktiven Nutzern eigene Photon-Instanz.

## Quellen

- OSM-Kachelrichtlinie: <https://operations.osmfoundation.org/policies/tiles/>
- FOSSGIS-Nutzungsbedingungen (Overpass): <https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen>
- Overpass API: <https://wiki.openstreetmap.org/wiki/Overpass_API>
- Photon: <https://github.com/komoot/photon>
- Open-Meteo Bedingungen und Preise: <https://open-meteo.com/en/terms>, <https://open-meteo.com/en/pricing>
- Hetzner Cloud: <https://www.hetzner.com/cloud>
- Protomaps Downloads: <https://docs.protomaps.com/basemaps/downloads>
- Hetzner Preiserhöhungen 2026: <https://www.tomshardware.com/tech-industry/hetzner-to-raise-prices-by-up-to-37-percent-from-april-1>
- Google Play Zahlungsrichtlinie: <https://play.google.com/about/monetization-ads/payments>
- Google und Spenden-Links (WireGuard): <https://www.phoronix.com/news/WireGuard-Ejected-Play-Store>, AnkiDroid 2026: <https://gigazine.net/gsc_news/en/20260902-ankidroid-google-play-policy-violation/>
- Apple EU-Regeln: <https://www.macrumors.com/2025/06/26/app-store-eu-rule-change-dma>
- Open Collective Europe Gebühren: <https://docs.opencollective.com/oceurope/how-it-works/financial-contributions-how-to-donate/setting-up-github-sponsors>
- Liberapay-Gebühren (Diskussion): <https://www.loomio.com/d/UZY5omVS>
