# Veröffentlichung

Fahrplan und Stand der Veröffentlichung. Hier wird alles festgehalten (statt GitHub-Issues). ✅ = erledigt, ⬜ = offen.

| Stufe | Ziel | Stand |
|---|---|---|
| **1 – Android-Beta, Baden-Württemberg** | Daten für BW online, Website, Spenden, signierte APK über GitHub, geschlossener Test bei Google Play, echte Testfahrten | **in Arbeit** |
| 2 – Android für alle, D-A-CH | Datenbau D-A-CH, Google Play öffentlich, F-Droid-Variante ohne In-App-Kauf | offen |
| 3 – iOS | Apple-Konto, Bau auf einem Mac, Sprachbefehle unter iOS | offen |

Kosten, Nutzungsgrenzen und Schwellen: [abhaengigkeiten-und-grenzen.md](abhaengigkeiten-und-grenzen.md). Monatliche Zahlen: [betriebszahlen.md](betriebszahlen.md).

---

## Stufe 1: was erledigt ist (Code)

- ✅ **Datenbau mit wählbarem Gebiet** ([daten.yml](../.github/workflows/daten.yml)): Standard Baden-Württemberg, umstellbar über Repository-Variablen; der Auszug wird vorher mit `osmium` auf Straßen, Orte, Tankstellen und Abbiegeverbote eingedampft. Das Manifest nennt das Gebiet; Punkte außerhalb meldet die App mit „… hat Straßendaten für Baden-Württemberg“.
- ✅ **Karte bis Zoom 14** und Probelauf für die Größe (`node scripts/build-map.mjs x --bbox … --dry-run`).
- ✅ **Gemessen** (10/2026):

  | Gebiet | Straßenpakete | Karte Zoom 14 | Karte Zoom 15 | Bauzeit Pakete (lokal) |
  |---|---:|---:|---:|---:|
  | Baden-Württemberg | 59 MB (519 Kacheln) | 0,47 GB | 0,99 GB | 3 min |
  | D-A-CH | ≈ 0,8 GB (hochgerechnet) | 4,89 GB | 10,0 GB | – |

  Route Bad Urach → Münsingen aus den BW-Paketen: 2 s ab leerem Cache, 16 Dateien, kein Overpass.
- ✅ **„Über Kurvenjagd“** in der App (Einstellungen): Version, Datenschutz in Kürze, Links zu Datenschutzerklärung und Impressum, Datenquellen, Lizenzen, Quellcode.
- ✅ **Website-Entwürfe** in [site/](../site/) (Start, Datenschutz, Impressum) mit Workflow [website.yml](../.github/workflows/website.yml), der sie auf den eigenen Server lädt. Lokal ansehen: `node scripts/serve.mjs` → <http://localhost:8765/site/>.
- ✅ **Signierte Android-Version** ([scripts/release-android.mjs](../scripts/release-android.mjs)): AAB für Google Play (Vertriebsweg „store“, Trinkgeld per In-App-Kauf) und APK für die Beta über GitHub (Weg „web“, Spenden-Links). Version kommt aus `package.json`. Mit Wegwerf-Schlüssel getestet.
- ✅ **Unterstützen-Bildschirm** geprüft: Web zeigt Monatsziel, Kosten, Liberapay/Überweisung, Feedback; Android (Store-Weg) zeigt ohne angelegte Produkte „Trinkgeld ist gerade nicht verfügbar“.
- ✅ Ortssuche bevorzugt Orte nahe dem Kartenausschnitt (vorher landete „Münsingen“ in der Schweiz).

## Stufe 1: was du tun musst

### 1. Name und Server

1. ⬜ **Markenrecherche** zum Namen „Kurvenjagd“ (DPMAregister, EUIPO TMview; Klassen 9, 42, 39) – vor dem Store-Eintrag.
2. ⬜ **Server einrichten** nach [server/README.md](../server/README.md): DNS-Eintrag `kurvenjagd.oli-tech.eu`, nginx mit HTTPS, Benutzer und SSH-Schlüssel nur für die Workflows.

### 2. Datenbau und Website auf GitHub

1. ⬜ Repository → Settings → Secrets and variables → Actions → **Secrets**: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `SERVER_KNOWN_HOSTS` (Inhalte siehe [server/README.md](../server/README.md#5-github)).
2. ⬜ Dort unter **Variables**: `SERVER_AKTIV` = `true`. (Gebiet bleibt Baden-Württemberg, solange `DATEN_PBF` usw. nicht gesetzt sind.)
3. ⬜ Actions → „Daten bauen“ und „Website“ → **Run workflow**. Danach prüfen: <https://kurvenjagd.oli-tech.eu/daten/v1/manifest.json> nennt `"region":"Baden-Württemberg"`, <https://kurvenjagd.oli-tech.eu/> zeigt die Website.
   - Hinweis: Der Schritt „Auszug eindampfen“ (osmium) und der Upload per rsync sind noch nicht auf GitHub erprobt; beim ersten Lauf das Protokoll ansehen.
4. ⬜ `spendenziel.json` (Vorlage: [spendenziel.beispiel.json](spendenziel.beispiel.json)) mit echten Links auf den Server laden (Befehl in [server/README.md](../server/README.md#7-spendenziel)). Der Datenbau übernimmt sie in jeden neuen Stand.

### 3. Website mit Datenschutz und Impressum

1. ⬜ In [site/impressum.html](../site/impressum.html) und [site/datenschutz.html](../site/datenschutz.html) die gelb markierten **Platzhalter** ersetzen (Name, Anschrift, E-Mail, Datum, Aufsichtsbehörde) und den Entwurfs-Hinweis entfernen. Im Zweifel rechtlich prüfen lassen.
2. ⬜ In [site/index.html](../site/index.html) den Liberapay-Link ersetzen. Jeder Push in `site/` lädt die Website neu hoch.

### 4. Spenden und Wetter

1. ⬜ **Liberapay**-Konto anlegen (Team oder Person „Kurvenjagd“), Link in `spendenziel.json` und auf der Website eintragen. Optional GitHub Sponsors.
2. ⬜ **Anfrage an Open-Meteo** senden ([Entwurf](anfrage-open-meteo.md)) und Antwort hier vermerken.

### 5. Signaturschlüssel und Beta-APK

1. ⬜ **Schlüssel erzeugen** (einmalig, gut sichern – ohne ihn keine Updates der GitHub-APK):
   ```bash
   keytool -genkeypair -v -keystore kurvenjagd-release.jks -alias kurvenjagd -keyalg RSA -keysize 4096 -validity 10000
   ```
   `keytool` liegt im JDK (`D:\Android\jdk-21…\bin`). Die `.jks`-Datei außerhalb des Repos aufbewahren und zusätzlich sichern (z. B. Passwort-Manager + Backup).
2. ⬜ `android/keystore.properties` anlegen (wird nicht eingecheckt):
   ```properties
   storeFile=C:/Pfad/zu/kurvenjagd-release.jks
   storePassword=…
   keyAlias=kurvenjagd
   keyPassword=…
   ```
3. ⬜ **Beta-APK bauen** (nach dem ersten Datenbau):
   ```bash
   npm run release:apk
   ```
   (Daten und Website zeigen automatisch auf `https://kurvenjagd.oli-tech.eu/`.)
4. ⬜ Als **Vorabversion auf GitHub** veröffentlichen:
   ```bash
   gh release create v0.1.0-beta dist/Kurvenjagd-0.1.0.apk --prerelease --title "Kurvenjagd 0.1.0 Beta (Baden-Württemberg)"
   ```

### 6. Google Play (geschlossener Test)

1. ⬜ **Google-Play-Entwicklerkonto** anlegen (25 $ einmalig, Identitätsprüfung).
2. ⬜ App anlegen, **Play App Signing** aktivieren (Standard): Google verwaltet den App-Schlüssel, dein Schlüssel aus Schritt 5 dient nur zum Hochladen und lässt sich bei Verlust zurücksetzen.
3. ⬜ AAB bauen und im **geschlossenen Test** hochladen:
   ```bash
   npm run release:aab
   ```
   Neue private Konten müssen vor der Veröffentlichung einen geschlossenen Test mit einer Mindestzahl an Testern über mehrere Tage durchlaufen (zuletzt 12 Tester, 14 Tage) – aktuelle Vorgabe in der Play Console prüfen.
4. ⬜ Store-Eintrag: Kurzbeschreibung, Bildschirmfotos ([docs/bilder/](bilder/)), Link zur Datenschutzerklärung, Fragebogen „Datensicherheit“ (keine Datenerhebung durch die App; Standort/Audio werden nicht an uns übertragen – Spracherkennung über Google angeben).
5. ⬜ Optional: Trinkgeld-Produkte anlegen (In-App-Produkte `trinkgeld_2`, `trinkgeld_5`, `trinkgeld_10`, `trinkgeld_25`; Abo `unterstuetzer_monatlich`). Erfordert ein Händlerkonto.

### 7. Testfahrten

⬜ Mit 3–5 Leuten echte Touren in BW fahren und festhalten (in [betriebszahlen.md](betriebszahlen.md) oder hier):

- GPS-Verfolgung, Ansagen rechtzeitig und verständlich (mit Helm/Headset)?
- Neuberechnung nach Verfahren, Sprachbefehle bei Fahrtwind
- Akku nach 2 h Navigation, Verhalten bei Funkloch (Offline-Region vorher laden)
- Wie fühlen sich die Routen an (Kurvenlust 50 / 80 / 100 %)? Bewertungen in der App nutzen
- Bedienbarkeit mit Handschuhen, Lesbarkeit in der Sonne

## Stufe 2 und 3 (Merkliste)

- ⬜ D-A-CH: Variablen `DATEN_PBF`, `DATEN_NAME`, `KARTE_BBOX` setzen (siehe Kopf von [daten.yml](../.github/workflows/daten.yml)); Laufzeit und Speicher des GitHub-Rechners beobachten (max. 6 h).
- ⬜ F-Droid-Variante ohne `cordova-plugin-purchase` (unfreie Billing-Bibliothek), Spenden per Link.
- ⬜ Google Play öffentlich, Store-Texte, Bewertungen beantworten.
- ⬜ iOS: Apple-Konto (99 $/Jahr), Mac für den Bau, Spracherkennung unter iOS einbinden, App-Store-Prüfung.
- ⬜ Schwellen beobachten: eigene Photon-Instanz ab ~5.000 aktiven Nutzern, Open-Meteo-Tarif je nach Antwort.
