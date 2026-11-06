# Eigener Server (Hetzner Cloud)

Website und Daten von Kurvenjagd laufen auf einem Host:

| Adresse | Inhalt | kommt von |
|---|---|---|
| `https://kurvenjagd.oli-tech.eu/` | Website: Start, Datenschutz, Impressum | Workflow [website.yml](../.github/workflows/website.yml) aus `site/` |
| `https://kurvenjagd.oli-tech.eu/daten/v1/` | Straßenpakete, Karte (`map.pmtiles`), `manifest.json`, `spendenziel.json` | Workflow [daten.yml](../.github/workflows/daten.yml), wöchentlich |

Auf dem Server liegt alles unter `/srv/kurvenjagd/` (`site/`, `daten/v1/`). Es läuft nur ein Webserver für statische Dateien – keine Datenbank, kein Programm.

**Platzbedarf:** doppelte Datenmenge, weil der neue Stand erst vollständig hochgeladen und dann umgeschaltet wird. Beta Baden-Württemberg ≈ 1,2 GB, D-A-CH ≈ 12 GB. **Traffic:** in Hetzner-Cloud-Servern sind 20 TB/Monat enthalten (≈ 18 MB je aktivem Nutzer und Monat → reicht für sehr viele Nutzer).

## Einrichtung (einmalig, Debian/Ubuntu)

### 1. DNS

Beim DNS von `oli-tech.eu` (z. B. Hetzner DNS-Konsole) einen Eintrag `kurvenjagd` → IP des Servers anlegen: `A` (IPv4) und, falls vorhanden, `AAAA` (IPv6). In der Hetzner-Cloud-Firewall müssen Port 80 und 443 offen sein.

### 2. Pakete, Ordner, Benutzer für die Workflows

```bash
sudo apt update && sudo apt install -y nginx rsync certbot python3-certbot-nginx
sudo adduser --system --group --home /home/kurvenjagd --shell /bin/sh kurvenjagd
sudo mkdir -p /srv/kurvenjagd/site /srv/kurvenjagd/daten
sudo chown -R kurvenjagd:kurvenjagd /srv/kurvenjagd
sudo install -m 755 kurvenjagd-deploy.sh /usr/local/bin/kurvenjagd-deploy
```

`kurvenjagd-deploy.sh` (aus diesem Ordner) ist der einzige Befehl, den der Schlüssel der Workflows ausführen darf: Dateien per rsync unter `/srv/kurvenjagd` ablegen und den Datenstand umschalten. `rrsync` gehört zum Paket `rsync` (ab Debian 12 / Ubuntu 22.04 unter `/usr/bin/rrsync`).

### 3. SSH-Schlüssel für GitHub

Am PC ein eigenes Schlüsselpaar nur für die Workflows erzeugen:

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions kurvenjagd" -f kurvenjagd-deploy
```

Auf dem Server den **öffentlichen** Schlüssel (`kurvenjagd-deploy.pub`) mit erzwungenem Befehl eintragen:

```bash
sudo install -d -m 700 -o kurvenjagd -g kurvenjagd /home/kurvenjagd/.ssh
echo 'command="/usr/local/bin/kurvenjagd-deploy",restrict ssh-ed25519 AAAA…  github-actions kurvenjagd' | sudo tee /home/kurvenjagd/.ssh/authorized_keys
sudo chown kurvenjagd:kurvenjagd /home/kurvenjagd/.ssh/authorized_keys && sudo chmod 600 /home/kurvenjagd/.ssh/authorized_keys
```

(`AAAA…` durch den Inhalt von `kurvenjagd-deploy.pub` ersetzen.) Test vom PC: `ssh -i kurvenjagd-deploy kurvenjagd@kurvenjagd.oli-tech.eu bash` muss mit „nicht erlaubt“ enden.

### 4. Webserver und HTTPS

```bash
sudo cp nginx-kurvenjagd.conf /etc/nginx/sites-available/kurvenjagd
sudo ln -s /etc/nginx/sites-available/kurvenjagd /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d kurvenjagd.oli-tech.eu --redirect
```

certbot holt ein kostenloses Let's-Encrypt-Zertifikat, trägt HTTPS in die Datei ein und erneuert es automatisch. Wer Caddy statt nginx nutzt: [Caddyfile](Caddyfile) (Zertifikat kommt automatisch; nicht erprobt).

### 5. GitHub

Repository → Settings → Secrets and variables → Actions:

| Name | Art | Inhalt |
|---|---|---|
| `SERVER_HOST` | Secret | `kurvenjagd.oli-tech.eu` |
| `SERVER_USER` | Secret | `kurvenjagd` |
| `SERVER_SSH_KEY` | Secret | Inhalt der **privaten** Datei `kurvenjagd-deploy` (danach am PC sicher verwahren oder löschen) |
| `SERVER_KNOWN_HOSTS` | Secret | Ausgabe von `ssh-keyscan -t ed25519 kurvenjagd.oli-tech.eu` – Fingerabdruck vorher mit `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` auf dem Server vergleichen |
| `SERVER_AKTIV` | Variable | `true` |

Dann unter Actions „Website“ und „Daten bauen“ einmal per **Run workflow** starten.

### 6. Prüfen

```bash
curl -s https://kurvenjagd.oli-tech.eu/daten/v1/manifest.json | head -c 200        # nennt "region":"Baden-Württemberg"
curl -sI -H "Range: bytes=0-99" https://kurvenjagd.oli-tech.eu/daten/v1/map.pmtiles   # 206 Partial Content + Access-Control-Allow-Origin: *
```

### 7. Spendenziel

`spendenziel.json` (Vorlage: [docs/spendenziel.beispiel.json](../docs/spendenziel.beispiel.json)) monatlich hochladen – mit demselben Schlüssel:

```bash
rsync -e "ssh -i kurvenjagd-deploy" spendenziel.json kurvenjagd@kurvenjagd.oli-tech.eu:daten/v1/
```

Der wöchentliche Datenbau übernimmt die Datei in jeden neuen Stand.

## Betrieb

- **Updates:** `sudo apt install unattended-upgrades` spielt Sicherheitsupdates automatisch ein.
- **Protokolle:** nginx schreibt für Kurvenjagd keine Zugriffsprotokolle – außer für `manifest.json`, mit gekürzter IP-Adresse, 14 Tage (Standard-Rotation von nginx unter Debian/Ubuntu). Daraus grob die aktiven Geräte pro Tag:
  ```bash
  sudo awk '{print substr($2,2,11), $1}' /var/log/nginx/kurvenjagd-manifest.log | sort -u | awk '{print $1}' | uniq -c
  ```
  (Mobilfunk teilt sich oft Adressen – die Zahl ist eine Untergrenze. Für [docs/betriebszahlen.md](../docs/betriebszahlen.md).)
- **Später eigene Ortssuche (Photon):** läuft auf einem eigenen, größeren Server (16 GB RAM); dieser hier reicht dafür nicht unbedingt.
