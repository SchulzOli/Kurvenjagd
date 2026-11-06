#!/bin/sh
# Zugang für die GitHub-Workflows (Datenbau, Website) auf dem Server. Wird in ~kurvenjagd/.ssh/authorized_keys
# als erzwungener Befehl eingetragen (server/README.md). Der Schlüssel darf damit NUR:
#   1. per rsync Dateien unter /srv/kurvenjagd ablegen (rrsync sperrt alles außerhalb), und
#   2. einen fertig hochgeladenen Datenstand umschalten: „umschalten v1“.
# Keine Shell, keine anderen Befehle.
set -eu
BASE=${KURVENJAGD_BASE:-/srv/kurvenjagd}   # nur für Tests überschreibbar; SSH reicht keine Variablen durch

case "${SSH_ORIGINAL_COMMAND:-}" in
  "umschalten "*)
    v=${SSH_ORIGINAL_COMMAND#umschalten }
    case "$v" in v[0-9]|v[0-9][0-9]) ;; *) echo "ungültige Version: $v" >&2; exit 1 ;; esac
    cd "$BASE/daten"
    [ -d "$v.neu" ] || { echo "$v.neu fehlt" >&2; exit 1; }
    # von Hand gepflegtes Spendenziel in den neuen Stand übernehmen
    [ -f "$v/spendenziel.json" ] && cp -p "$v/spendenziel.json" "$v.neu/"
    # Umschalten in einem Rutsch: Apps sehen entweder den alten oder den neuen Stand, nie halbe Daten
    rm -rf "$v.alt"
    [ -d "$v" ] && mv "$v" "$v.alt"
    mv "$v.neu" "$v"
    rm -rf "$v.alt"
    echo "Datenstand $v umgeschaltet"
    ;;
  rsync\ --server*)
    exec /usr/bin/rrsync "$BASE"
    ;;
  *)
    echo "nicht erlaubt" >&2
    exit 1
    ;;
esac
