# Betriebszahlen

Einmal im Monat eintragen – am besten zusammen mit der Aktualisierung von `spendenziel.json`. Die App selbst misst nichts und sendet nichts; alle Zahlen kommen aus den Konsolen der Anbieter.

## Woher die Zahlen kommen

| Zahl | Wo ablesen | Bedeutung |
|---|---|---|
| Aktive Geräte (Android) | Play Console → Statistiken → „Aktive Geräte“ (30 Tage) | wichtigste Größe für alle Schwellen |
| Downloads Beta-APK | GitHub → Releases → Asset-Downloads (`gh release view --json assets`) | grobe Größe vor Google Play |
| Geräte pro Tag (Abrufe `manifest.json`) | Server: gekürztes Protokoll `/var/log/nginx/kurvenjagd-manifest.log`, Auswertung siehe [server/README.md](../server/README.md#betrieb) | ≈ Geräte, die an dem Tag die App mit Netz geöffnet haben (Untergrenze, Mobilfunk teilt Adressen) |
| Traffic / Platz | Hetzner Cloud Console → Server → Grafiken bzw. `df -h /srv` | gegen 20 TB Traffic/Monat und den freien Platz (Daten ×2 beim Umschalten) |
| Kosten | Hetzner-Rechnung, Stores | für das Spendenziel |
| Spenden | Liberapay, GitHub Sponsors, Konto, Store-Berichte | für das Spendenziel |
| Photon gedrosselt? | Fehlermeldungen der Ortssuche, Rückmeldungen | Signal für eigene Instanz |

## Schwellen

| Wenn … | dann … | Kosten |
|---|---|---|
| aktive Geräte > 5.000 oder Photon drosselt | eigene Photon-Instanz (D-A-CH) | ca. 20–25 €/Monat |
| Open-Meteo wertet Spenden als kommerziell oder > 10.000 Wetter-Abfragen/Tag (≈ 50.000 Geräte) | bezahlter Open-Meteo-Tarif, `KJ_WEATHER_URL` setzen | wenige € bis ca. 30 €/Monat |
| Traffic > 10 TB/Monat oder Platz knapp | größeren Server oder eigenen Server nur für Kurvenjagd; Hetzner berechnet Mehr-Traffic günstig | wenige € |
| Datenbau läuft länger als ~4 h | Bau aufteilen (Straßen / Karte) oder Bau-Server mieten | 0–10 €/Monat |

## Protokoll

| Monat | Aktive Geräte | APK-Downloads | Geräte/Tag (Ø, Manifest) | Traffic | Platz | Kosten | Spenden | Bemerkungen |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 2026-11 | – | – | – | – | – | – | – | Stufe 1 in Vorbereitung |
