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
- ✅ **„Über Kurvenjäger“** in der App (Einstellungen): Version, Datenschutz in Kürze, Links zu Datenschutzerklärung und Impressum, Datenquellen, Lizenzen, Quellcode.
- ✅ **Website-Entwürfe** in [site/](../site/) (Start, Datenschutz, Impressum) mit Workflow [website.yml](../.github/workflows/website.yml) für GitHub Pages. Lokal ansehen: `node scripts/serve.mjs` → <http://localhost:8765/site/>.
- ✅ **Signierte Android-Version** ([scripts/release-android.mjs](../scripts/release-android.mjs)): AAB für Google Play (Vertriebsweg „store“, Trinkgeld per In-App-Kauf) und APK für die Beta über GitHub (Weg „web“, Spenden-Links). Version kommt aus `package.json`. Mit Wegwerf-Schlüssel getestet.
- ✅ **Unterstützen-Bildschirm** geprüft: Web zeigt Monatsziel, Kosten, Liberapay/Überweisung, Feedback; Android (Store-Weg) zeigt ohne angelegte Produkte „Trinkgeld ist gerade nicht verfügbar“.
- ✅ Ortssuche bevorzugt Orte nahe dem Kartenausschnitt (vorher landete „Münsingen“ in der Schweiz).

## Stufe 1: was du tun musst

### 1. Domain und Datenspeicher (Cloudflare R2)

1. ⬜ **Markenrecherche** zum Namen „Kurvenjäger“ (DPMAregister, EUIPO TMview) – vor Domain und Store-Eintrag.
2. ⬜ **Domain** registrieren (z. B. `kurvenjaeger.de`) und in Cloudflare hinzufügen (Nameserver auf Cloudflare umstellen).
3. ⬜ **R2 aktivieren** (Cloudflare-Dashboard → R2; ein Zahlungsmittel muss hinterlegt werden, im Freikontingent fallen keine Kosten an) und einen Bucket anlegen, z. B. `kurvenjaeger-daten`.
4. ⬜ Bucket → Settings → **Custom Domain**: `daten.kurvenjaeger.de`.
5. ⬜ Bucket → Settings → **CORS-Richtlinie**:
   ```json
   [{ "AllowedOrigins": ["https://localhost", "capacitor://localhost", "https://schulzoli.github.io", "https://kurvenjaeger.de"],
      "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"], "MaxAgeSeconds": 86400 }]
   ```
6. ⬜ R2 → **API-Token** erstellen („Object Read & Write“, nur dieser Bucket). Notieren: Access Key ID, Secret Access Key, Account ID.

### 2. Datenbau auf GitHub

1. ⬜ Repository → Settings → Secrets and variables → Actions → **Secrets**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
2. ⬜ Dort unter **Variables**: `DATEN_AKTIV` = `true`. (Gebiet bleibt Baden-Württemberg, solange `DATEN_PBF` usw. nicht gesetzt sind.)
3. ⬜ Actions → „Daten bauen“ → **Run workflow**. Danach prüfen: <https://daten.kurvenjaeger.de/v1/manifest.json> lädt und nennt `"region":"Baden-Württemberg"`.
   - Hinweis: Der Schritt „Auszug eindampfen“ (osmium) ist nur auf GitHub lauffähig und dort noch nicht erprobt; beim ersten Lauf das Protokoll ansehen.
4. ⬜ `spendenziel.json` (Vorlage: [spendenziel.beispiel.json](spendenziel.beispiel.json)) mit echten Links nach `v1/spendenziel.json` in den Bucket hochladen. Der Datenbau löscht sie nicht.

### 3. Website mit Datenschutz und Impressum

1. ⬜ In [site/impressum.html](../site/impressum.html) und [site/datenschutz.html](../site/datenschutz.html) die gelb markierten **Platzhalter** ersetzen (Name, Anschrift, E-Mail, Datum, Datenspeicher-Adresse, Aufsichtsbehörde) und den Entwurfs-Hinweis entfernen. Im Zweifel rechtlich prüfen lassen.
2. ⬜ In [site/index.html](../site/index.html) den Liberapay-Link ersetzen.
3. ⬜ Repository → Settings → **Pages** → Source: „GitHub Actions“. Nach dem nächsten Push in `site/` ist die Seite unter <https://schulzoli.github.io/Kurvenjagd/> erreichbar. (Eigene Domain später: Pages → Custom domain, dann `KJ_SITE_URL` beim App-Bau setzen.)

### 4. Spenden und Wetter

1. ⬜ **Liberapay**-Konto anlegen (Team oder Person „Kurvenjäger“), Link in `spendenziel.json` und auf der Website eintragen. Optional GitHub Sponsors.
2. ⬜ **Anfrage an Open-Meteo** senden ([Entwurf](anfrage-open-meteo.md)) und Antwort hier vermerken.

### 5. Signaturschlüssel und Beta-APK

1. ⬜ **Schlüssel erzeugen** (einmalig, gut sichern – ohne ihn keine Updates der GitHub-APK):
   ```bash
   keytool -genkeypair -v -keystore kurvenjaeger-release.jks -alias kurvenjaeger -keyalg RSA -keysize 4096 -validity 10000
   ```
   `keytool` liegt im JDK (`D:\Android\jdk-21…\bin`). Die `.jks`-Datei außerhalb des Repos aufbewahren und zusätzlich sichern (z. B. Passwort-Manager + Backup).
2. ⬜ `android/keystore.properties` anlegen (wird nicht eingecheckt):
   ```properties
   storeFile=C:/Pfad/zu/kurvenjaeger-release.jks
   storePassword=…
   keyAlias=kurvenjaeger
   keyPassword=…
   ```
3. ⬜ **Beta-APK bauen** (nach dem ersten Datenbau):
   ```bash
   KJ_DATA_URL=https://daten.kurvenjaeger.de/v1/ npm run release:apk
   ```
4. ⬜ Als **Vorabversion auf GitHub** veröffentlichen:
   ```bash
   gh release create v0.1.0-beta dist/Kurvenjaeger-0.1.0.apk --prerelease --title "Kurvenjäger 0.1.0 Beta (Baden-Württemberg)"
   ```

### 6. Google Play (geschlossener Test)

1. ⬜ **Google-Play-Entwicklerkonto** anlegen (25 $ einmalig, Identitätsprüfung).
2. ⬜ App anlegen, **Play App Signing** aktivieren (Standard): Google verwaltet den App-Schlüssel, dein Schlüssel aus Schritt 5 dient nur zum Hochladen und lässt sich bei Verlust zurücksetzen.
3. ⬜ AAB bauen und im **geschlossenen Test** hochladen:
   ```bash
   KJ_DATA_URL=https://daten.kurvenjaeger.de/v1/ npm run release:aab
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
