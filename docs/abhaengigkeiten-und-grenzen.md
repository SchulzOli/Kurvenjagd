# Abhängigkeiten, Nutzungsgrenzen und Kosten

Alles, wovon Kurvenjagd abhängt: was du wie stark nutzen darfst, ab wann du es selbst betreiben solltest und was das ungefähr kostet. Stand: Oktober 2026. Preise und Regeln ändern sich – vor dem Start bei den Anbietern prüfen (Links unten). Keine Rechtsberatung.

**Annahme für alle Rechnungen:** Ein aktiver Nutzer plant im Monat ~4 Touren und fährt ~2. Das ergibt je Nutzer und Monat etwa 1.200 Dateiabrufe (Kartenkacheln + Straßenpakete), ~6 Wetter-Abfragen und ~20–100 Ortssuchen (Tippen in der Suche, Ortsnamen der Punkte).

---

## 1. Externe Dienste, die die App im Betrieb anfragt

| Dienst | Wofür | Was du darfst | Ab wann selbst betreiben | Kosten selbst betrieben |
|---|---|---|---|---|
| **Photon** von komoot (`photon.komoot.io`) | Ortssuche, Ortsnamen der Punkte, „Zwischenstopp in …“ | Kostenlos „solange die Zahl der Anfragen in einem vernünftigen Rahmen bleibt“; starke Nutzung wird gedrosselt oder gesperrt. **Keine feste Zahl.** | Ab ca. **5.000 aktiven Nutzern** (≈ 100.000–500.000 Anfragen/Monat) oder sobald komoot drosselt | Eigene Photon-Instanz nur für D-A-CH: Server mit 16 GB RAM, **ca. 20–25 €/Monat** (Hetzner o. ä.); ab ~50.000 Nutzern größer, ca. 40 € |
| **Open-Meteo** (`api.open-meteo.com`) | Wetter entlang der Route | Kostenlos **nur nicht-kommerziell**, ohne Schlüssel, unter **10.000 Anfragen/Tag, 5.000/Stunde, 600/Minute**; Nennung „Open-Meteo“ (CC BY 4.0). Ob eine App mit freiwilligen Spenden „nicht-kommerziell“ ist, ist offen → [Anfrage-Entwurf](anfrage-open-meteo.md) | Sofort, falls Open-Meteo die Spenden als kommerziell wertet; sonst ab ~**50.000 Nutzern** (≈ 10.000 Anfragen/Tag) | Bezahlter Tarif: kleine Tarife ab wenigen Euro bis ca. 30 €/Monat (Angaben widersprüchlich, auf der Preisseite prüfen). Selbst betreiben (Open Source, Docker) möglich, aber aufwendig – lieber bezahlen |
| **AWS Terrain Tiles** (`s3.amazonaws.com/elevation-tiles-prod`) | Höhenmodell: Höhenmeter, Steigung, Geländeschattierung | Öffentlicher Datensatz im Open-Data-Programm von AWS; Amazon trägt die Kosten, **kein Konto, keine Grenze genannt**. Zitierpflicht: „Terrain Tiles … from registry.opendata.aws/terrain-tiles“, Quellen der Höhendaten nennen. Keine Verfügbarkeitsgarantie | Nur falls AWS den Datensatz einstellt oder er unzuverlässig wird | D-A-CH-Kacheln Zoom 11/12 (~2 GB) einmalig in den eigenen Speicher kopieren: **praktisch 0 €** |
| **Eigener Server** (Hetzner Cloud, `kurvenjagd.oli-tech.eu`) | Website, Straßenpakete und Vektorkarte (gemessen: BW 0,53 GB, D-A-CH ≈ 5,7 GB bis Zoom 14; beim Umschalten kurz doppelt) | Dein eigener Dienst. **20 TB Traffic/Monat inklusive** (≈ 18 MB je Nutzer und Monat → reicht für sehr viele Nutzer) | – (ist schon selbst betrieben) | vorhandener Server: 0 € extra; eigener Server nur dafür ca. 5,50 €/Monat |
| **Spracherkennung** (Android: Google-Spracherkennung; Browser: Web Speech API) | Sprachbefehle | Systemfunktion, kostenlos, keine Grenze. **Datenschutz:** Die Sprachaufnahme geht dabei meist an Google → in der Datenschutzerklärung nennen | – | – |
| **Sprachausgabe** (Sprach-Engine des Geräts) | Ansagen | Systemfunktion, offline, kostenlos | – | – |

**Nicht mehr im Betrieb genutzt** (nur noch Entwicklung): öffentliche **Overpass**-Server (Regeln verbieten Apps mit viel Verkehr; Faustregel ~100 Abfragen/Tag) und die **OSM-Kartenkacheln** (Verteilen einer App damit ohne Erlaubnis verboten).

## 2. Dienste, die nur der wöchentliche Datenbau nutzt

| Dienst | Wofür | Was du darfst | Ab wann anders lösen | Kosten |
|---|---|---|---|---|
| **Geofabrik** (`download.geofabrik.de`) | OSM-Auszug D-A-CH als Grundlage der Straßenpakete | Kostenlos; Geofabrik bittet, nicht dieselbe Datei wiederholt zu laden und Skripte zu überwachen (bei Missbrauch werden IP-Bereiche gesperrt). **Einmal pro Woche ist unproblematisch.** | Bei täglichem Bau: nur die Änderungen laden (`pyosmium-up-to-date`, spart ~98 % Verkehr) | 0 € |
| **Protomaps-Weltbau** (`build.protomaps.com`) | Quelle der Vektorkarte (Ausschnitt D-A-CH) | Kostenlos zum **Herunterladen und Ausschneiden**; direktes Einbinden in Apps („Hotlinking“) ist unerwünscht – deshalb kopieren wir den Ausschnitt in den eigenen Speicher | Falls die Builds wegfallen: Karte selbst mit Planetiler aus dem Geofabrik-Auszug bauen (Open Source, läuft im selben GitHub-Job) | 0 € |
| **GitHub Actions** | Baut jeden Montag Pakete und Karte, lädt sie hoch; Tests bei jedem Push | **Kostenlos für öffentliche Repositories.** Grenzen: max. **6 Stunden je Job**; Standard-Rechner laut GitHub-Doku 4 Kerne, 16 GB RAM, ~14 GB freier Plattenplatz | Falls D-A-CH nicht in 6 h / 14 GB passt: Bau in zwei Jobs teilen (Straßen / Karte) oder kleinen Server mieten | 0 €; eigener Bau-Server ca. 5–10 €/Monat (oder nur stundenweise) |

## 3. Plattformen und Konten

| Was | Wofür | Bedingungen | Kosten |
|---|---|---|---|
| **GitHub** (Repository, Issues) | Code, Mitwirkende, Fehlerberichte | Kostenlos für öffentliche Projekte | 0 € |
| **Website** auf dem eigenen Server | Datenschutzerklärung, Impressum, Spenden-Link, optional Web-App | per Workflow aus `site/` hochgeladen | 0 € |
| **Domain** `oli-tech.eu` mit Subdomain `kurvenjagd` | Website und Daten unter eigenem Namen | vorhanden | 0 € extra |
| **Google Play** | Android-Store | Einmalige Registrierung; In-App-Käufe (Trinkgeld) müssen über Google laufen, **15 % Gebühr** bis 1 Mio. $ Umsatz/Jahr; externe Spenden-Links riskieren die Entfernung | **25 $ einmalig** |
| **Apple Developer Program** | App Store (iOS) | Pflicht für iOS; Trinkgeld nur per In-App-Kauf, **15 %** im Small Business Program (muss man beantragen) | **99 $/Jahr** (~7,50 €/Monat) |
| **F-Droid** | Open-Source-Store für Android | Kostenlos; **nur freie Software**: Die Version für F-Droid darf `cordova-plugin-purchase` nicht enthalten (es bringt Googles unfreie Billing-Bibliothek mit) → eigene Build-Variante ohne In-App-Kauf, Spenden dort per Link (`KJ_CHANNEL=fdroid`) | 0 € |

## 4. Zahlungswege für Spenden

| Weg | Bedingungen | Kosten |
|---|---|---|
| **Liberapay** | Gemeinnütziger Verein, Open Source; regelmäßige Spenden, Betrag frei wählbar | 0 % Plattformgebühr; nur Gebühren des Zahlungsanbieters (Stripe/PayPal, grob 2–4 % + Fixbetrag je Zahlung) |
| **GitHub Sponsors** | Konto mit Auszahlung über Stripe | 0 % für persönliche Konten |
| **Überweisung / Dauerauftrag** | IBAN und Name werden öffentlich | 0 € |
| **In-App-Trinkgeld** (Play, App Store) | Pflichtweg in Store-Apps | 15 % an den Store |

Spenden an eine Privatperson sind steuerpflichtige Einnahmen (keine Spendenquittung möglich).

## 5. Bibliotheken im Code

Alle frei nutzbar, **ohne Nutzungsgrenzen und ohne Kosten**. Pflicht ist nur, die Lizenzhinweise mitzuliefern (stehen in [NOTICE.md](../NOTICE.md)); alle sind mit der GPL-3.0 des Projekts vereinbar.

| Bibliothek | Lizenz | Hinweis |
|---|---|---|
| Leaflet | BSD-2-Clause | – |
| protomaps-leaflet, pmtiles, @protomaps/basemaps | BSD-3-Clause | – |
| fflate | MIT | – |
| Capacitor und Capacitor-Plugins (Dateisystem, Teilen, Netz, Sprachausgabe, Spracherkennung, Bildschirm an) | MIT | Spracherkennung unter iOS noch nicht eingebunden |
| cordova-plugin-purchase | MIT | enthält in Android-Builds Googles unfreie Billing-Bibliothek → nicht für F-Droid |
| esbuild, @capacitor/cli, @capacitor/assets | MIT | nur beim Bauen |
| pyosmium | BSD-2-Clause | nur beim Datenbau |

## 6. Gesamtkosten nach Nutzerzahl

Monatlich, gerundet; „Wetter“ nur falls Open-Meteo einen bezahlten Tarif verlangt. Ausführliche Herleitung und Spendenziel: [finanzierung-und-betrieb.md](finanzierung-und-betrieb.md).

| Aktive Nutzer | Apple (ab iOS) | Server (vorhanden) | Ortssuche | **Summe** | + Wetter-Tarif |
|---:|---:|---:|---:|---:|---:|
| Beta, nur Android | – | 0 € | 0 € (komoot) | **0 €** | ~30 € |
| 1.000 | 7,50 € | 0 € | 0 € (komoot) | **7,50 €** | ~37 € |
| 5.000 | 7,50 € | 0 € | 0 € (komoot, Grenzbereich) | **7,50 €** | ~37 € |
| 10.000 | 7,50 € | 0 € | ~20 € (eigene Instanz) | **27,50 €** | ~57 € |
| 50.000 | 7,50 € | 0 € (≈ 0,9 TB) | ~20 € | **27,50 €** | ~57 € |
| 100.000 | 7,50 € | 0 € (≈ 1,8 TB) | ~40 € | **47,50 €** | ~77 € |

Ein eigener Server nur für Kurvenjagd statt des vorhandenen: ca. 5,50 €/Monat mehr. Einmalig: Google Play 25 $. Nicht enthalten: Arbeitszeit, Steuerberatung.

## 7. Was vor dem Veröffentlichen noch zu tun ist

1. Server nach [server/README.md](../server/README.md) einrichten, Secrets und `SERVER_AKTIV=true` im Repo setzen, ersten Datenbau laufen lassen.
2. Open-Meteo anfragen.
3. Website mit **Datenschutzerklärung** (nennt Photon, Open-Meteo, AWS, eigenen Speicher, Google-Spracherkennung, Stores) und **Impressum**.
4. Markenrecherche zum Namen (DPMA, EUIPO).
5. F-Droid-Variante ohne `cordova-plugin-purchase` vorbereiten.

## Quellen

- Photon: <https://github.com/komoot/photon>
- Open-Meteo Bedingungen und Preise: <https://open-meteo.com/en/terms>, <https://open-meteo.com/en/pricing>
- AWS Terrain Tiles: <https://registry.opendata.aws/terrain-tiles/>
- Hetzner Cloud (Traffic, Preise): <https://www.hetzner.com/cloud>
- Geofabrik zu verantwortungsvollem Herunterladen: <https://blog.geofabrik.de/index.php/2025/09/10/download-responsibly/>
- Protomaps Downloads: <https://docs.protomaps.com/basemaps/downloads>
- GitHub Actions Grenzen und Abrechnung: <https://docs.github.com/en/actions/reference/limits>, <https://docs.github.com/actions/learn-github-actions/usage-limits-billing-and-administration>
- F-Droid Aufnahmeregeln: <https://f-droid.org/docs/Inclusion_Policy/>
- Store-Gebühren: <https://www.macrumors.com/2021/03/16/google-to-lower-play-store-commission>, <https://appbot.co/blog/app-developers-apple-google-small-business-programs/>
- OSM-Kachelrichtlinie: <https://operations.osmfoundation.org/policies/tiles/>; FOSSGIS (Overpass): <https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen>
