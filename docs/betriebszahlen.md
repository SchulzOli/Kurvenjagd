# Betriebszahlen

Einmal im Monat eintragen – am besten zusammen mit der Aktualisierung von `spendenziel.json`. Die App selbst misst nichts und sendet nichts; alle Zahlen kommen aus den Konsolen der Anbieter.

## Woher die Zahlen kommen

| Zahl | Wo ablesen | Bedeutung |
|---|---|---|
| Aktive Geräte (Android) | Play Console → Statistiken → „Aktive Geräte“ (30 Tage) | wichtigste Größe für alle Schwellen |
| Downloads Beta-APK | GitHub → Releases → Asset-Downloads (`gh release view --json assets`) | grobe Größe vor Google Play |
| Abrufe `manifest.json` pro Tag | Cloudflare → R2 → Bucket → Metrics bzw. Analytics der Domain | ≈ Geräte, die an dem Tag die App mit Netz geöffnet haben (Manifest wird höchstens alle 6 h neu geladen) |
| R2 Speicher / Lesezugriffe | Cloudflare → R2 → Übersicht | gegen das Freikontingent (10 GB, 10 Mio. Lesezugriffe/Monat) |
| Kosten | Cloudflare-Rechnung, Domain, Stores | für das Spendenziel |
| Spenden | Liberapay, GitHub Sponsors, Konto, Store-Berichte | für das Spendenziel |
| Photon gedrosselt? | Fehlermeldungen der Ortssuche, Rückmeldungen | Signal für eigene Instanz |

## Schwellen

| Wenn … | dann … | Kosten |
|---|---|---|
| aktive Geräte > 5.000 oder Photon drosselt | eigene Photon-Instanz (D-A-CH) | ca. 20–25 €/Monat |
| Open-Meteo wertet Spenden als kommerziell oder > 10.000 Wetter-Abfragen/Tag (≈ 50.000 Geräte) | bezahlter Open-Meteo-Tarif, `KJ_WEATHER_URL` setzen | wenige € bis ca. 30 €/Monat |
| R2 > 10 GB oder > 10 Mio. Lesezugriffe/Monat | nichts tun, kostet nur wenig (0,015 $/GB, 0,36 $/Mio.); ggf. Cloudflare Worker als Cache davor | wenige € |
| Datenbau läuft länger als ~4 h | Bau aufteilen (Straßen / Karte) oder Bau-Server mieten | 0–10 €/Monat |

## Protokoll

| Monat | Aktive Geräte | APK-Downloads | Manifest-Abrufe/Tag (Ø) | R2 Speicher | R2 Lesezugriffe | Kosten | Spenden | Bemerkungen |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 2026-11 | – | – | – | – | – | – | – | Stufe 1 in Vorbereitung |
