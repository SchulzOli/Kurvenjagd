# Sicherheit

Gefundene Sicherheitslücken bitte **nicht** als öffentliches Issue melden, sondern vertraulich über GitHub: Reiter **Security** → **Report a vulnerability** in diesem Repository.

Bitte beschreiben: betroffene Version und Plattform (Android, iOS, Web), Schritte zum Nachstellen und mögliche Auswirkungen. Wir melden uns so schnell wie möglich, meist innerhalb einer Woche.

## Was die App verarbeitet

- **Keine Konten, keine Server mit Nutzerdaten.** Routen, Fahrten, GPS-Spuren und das Fahrprofil liegen nur auf dem Gerät.
- Die App lädt öffentliche Daten: Straßenpakete und Karte vom Projekt-Speicher, Höhendaten (AWS), Wetter (Open-Meteo), Ortssuche (Photon). Dabei werden Kartenausschnitte bzw. Koordinaten an diese Dienste übertragen, aber keine Kennungen.
- Spenden laufen über externe Anbieter (Liberapay, GitHub Sponsors) bzw. den In-App-Kauf der Stores; die App sieht keine Zahlungsdaten.

Unterstützt wird jeweils die neueste Version.
