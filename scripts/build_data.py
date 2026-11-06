"""Baut die Straßenpakete für Kurvenjagd aus einem OSM-Auszug (z. B. Geofabrik dach-latest.osm.pbf).

Ersetzt zur Laufzeit die öffentlichen Overpass-Server: Die App lädt statt einer Abfrage fertige
Dateien je 0,1°-Kachel von einem Speicher mit CDN (oder aus dem Ordner www/data beim Entwickeln).

Aufruf:
    python scripts/build_data.py <eingabe.osm.pbf> <ausgabe-ordner> [--bbox s,w,n,e] [--name "Baden-Württemberg"]

Ausgabe:
    manifest.json            Bauzeit, OSM-Stand, vorhandene Kacheln
    roads/t{i}_{j}.json.gz   Hauptstraßen + Abbiegeverbote + Ortsnamen + Tankstellen/Rasten
    local/t{i}_{j}.json.gz   Wohn- und Spielstraßen (lädt die App nur rund um Start, Stopps und Ziel)

Das Format der Straßen entspricht packWays/packRels in src/store.js, damit die App die Pakete
unverändert in ihren Kachel-Cache legen kann. Benötigt: pip install osmium (pyosmium ≥ 4), Node.js.
"""
import argparse
import gzip
import json
import math
import os
import subprocess
import sys
import time
from collections import defaultdict

import osmium

sys.stdout.reconfigure(encoding='utf-8')

TILE = 0.1
FORMAT = 1  # erhöhen, wenn sich der Aufbau der Dateien ändert (App prüft es im Manifest)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def app_constants():
    """Straßenklassen und Tags direkt aus dem App-Code lesen, damit beide nie auseinanderlaufen."""
    js = ("Promise.all([import('./src/router.js'), import('./src/features.js')]).then(([r, f]) => "
          "console.log(JSON.stringify({ main: r.MAIN_ROADS, local: r.LOCAL_ROADS, feat: f.FEATURE_TAGS })))")
    out = subprocess.run(['node', '--input-type=module', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True)
    c = json.loads(out.stdout)
    return set(c['main'].split('|')), set(c['local'].split('|')), ['highway', 'name', 'ref', 'oneway', 'junction', *c['feat']]


MAIN, LOCAL, WAY_TAGS = app_constants()
REL_TAGS = ['type', 'restriction', 'restriction:motorcycle', 'except']
BLOCKED = {'no', 'private'}
PLACES = {'city': 'c', 'town': 't', 'village': 'v'}
POIS = {'fuel': 'f', 'cafe': 'r', 'restaurant': 'r', 'biergarten': 'r', 'fast_food': 'r'}


def tiles_for(s, w, n, e):
    for i in range(math.floor(s / TILE), math.floor(n / TILE) + 1):
        for j in range(math.floor(w / TILE), math.floor(e / TILE) + 1):
            yield i, j


def tile_of(lat, lon):
    return math.floor(lat / TILE), math.floor(lon / TILE)


def drivable(tags):
    """Gleiche Bedingungen wie ACCESS in src/router.js."""
    return not (tags.get('access') in BLOCKED or tags.get('motor_vehicle') in BLOCKED
                or tags.get('motorcycle') in BLOCKED or tags.get('area') == 'yes')


def build(src, out, bbox, region=None):
    t0 = time.time()
    # Gepackte Wege als fertiger JSON-Text: braucht ein Vielfaches weniger Speicher als Python-Listen (wichtig für D-A-CH)
    roads = defaultdict(list)    # (i, j) -> Hauptstraßen
    local = defaultdict(list)    # (i, j) -> Nebenstraßen
    way_tiles = {}               # Weg-ID -> (Liste, Kacheln) für die Zuordnung der Abbiegeverbote
    places = defaultdict(list)
    pois = defaultdict(list)
    rels = []
    stat = defaultdict(int)

    fp = (osmium.FileProcessor(src)
          .with_locations()
          .with_filter(osmium.filter.KeyFilter('highway', 'place', 'amenity', 'restriction', 'type')))
    for o in fp:
        tags = dict(o.tags)
        if o.is_node():
            name = tags.get('name')
            if not o.location.valid():
                continue
            lat, lon = o.location.lat, o.location.lon
            if tags.get('place') in PLACES and name:
                places[tile_of(lat, lon)].append([name, round(lat, 5), round(lon, 5), PLACES[tags['place']]])
            elif tags.get('amenity') in POIS:
                pois[tile_of(lat, lon)].append([round(lat, 5), round(lon, 5), POIS[tags['amenity']],
                                                name or tags.get('brand') or '', tags.get('addr:city', '')])
        elif o.is_way():
            hw = tags.get('highway')
            coords = [(n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
            if len(coords) != len(o.nodes) or len(coords) < 2:
                if hw:
                    stat['ways_incomplete'] += 1
                continue
            if tags.get('amenity') in POIS:  # Tankstelle als Fläche: Mittelpunkt
                lat = sum(c[0] for c in coords) / len(coords)
                lon = sum(c[1] for c in coords) / len(coords)
                pois[tile_of(lat, lon)].append([round(lat, 5), round(lon, 5), POIS[tags['amenity']],
                                                tags.get('name') or tags.get('brand') or '', tags.get('addr:city', '')])
            if not hw or (hw not in MAIN and hw not in LOCAL) or not drivable(tags):
                continue
            packed = json.dumps([o.id, [n.ref for n in o.nodes], [v for c in coords for v in (round(c[0], 7), round(c[1], 7))],
                                 {k: tags[k] for k in WAY_TAGS if k in tags}], ensure_ascii=False, separators=(',', ':'))
            lats, lons = [c[0] for c in coords], [c[1] for c in coords]
            target = roads if hw in MAIN else local
            touched = list(tiles_for(min(lats), min(lons), max(lats), max(lons)))
            for t in touched:
                target[t].append(packed)
            way_tiles[o.id] = (target, touched)
            stat['main' if hw in MAIN else 'local'] += 1
        elif o.is_relation() and tags.get('type') == 'restriction':
            rels.append([o.id, {k: tags[k] for k in REL_TAGS if k in tags},
                         [[m.type, m.ref, m.role] for m in o.members]])

    # Abbiegeverbote zu jeder Kachel, die einen ihrer Wege enthält (wie relsFor in src/tiles.js)
    rel_tiles = {'roads': defaultdict(list), 'local': defaultdict(list)}
    for rel in rels:
        hits = set()
        for t, ref, _ in rel[2]:
            if t == 'w' and ref in way_tiles:
                target, touched = way_tiles[ref]
                kind = 'roads' if target is roads else 'local'
                hits.update((kind, tt) for tt in touched)
        for kind, tt in hits:
            rel_tiles[kind][tt].append(rel)
        stat['relations'] += bool(hits)

    inside = (lambda i, j: True) if not bbox else (
        lambda i, j: i * TILE >= bbox[0] - 1e-9 and j * TILE >= bbox[1] - 1e-9
        and (i + 1) * TILE <= bbox[2] + 1e-9 and (j + 1) * TILE <= bbox[3] + 1e-9)

    os.makedirs(os.path.join(out, 'roads'), exist_ok=True)
    os.makedirs(os.path.join(out, 'local'), exist_ok=True)
    built = int(time.time() * 1000)

    def write(kind, key, data, ways):
        path = os.path.join(out, kind, f'{key}.json.gz')
        head = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as f:
            f.write(head[:-1] + ',"ways":[' + ','.join(ways) + ']}')  # Wege sind schon JSON-Text
        return os.path.getsize(path)

    tiles, local_tiles, size = [], [], 0
    for (i, j), ways in sorted(roads.items()):
        if not inside(i, j):
            continue
        key = f't{i}_{j}'
        size += write('roads', key, {'v': FORMAT, 'built': built, 'rels': rel_tiles['roads'][(i, j)],
                                     'places': places[(i, j)], 'pois': pois[(i, j)]}, ways)
        tiles.append(key)
    for (i, j), ways in sorted(local.items()):
        if not inside(i, j):
            continue
        key = f't{i}_{j}'
        size += write('local', key, {'v': FORMAT, 'built': built, 'rels': rel_tiles['local'][(i, j)]}, ways)
        local_tiles.append(key)

    header = fp.header
    manifest = {
        'v': FORMAT, 'built': built, 'tile': TILE, 'source': os.path.basename(src), 'region': region,
        'osm': header.get('osmosis_replication_timestamp') or None,
        'bbox': bbox or None, 'tiles': tiles, 'local': local_tiles,
        'license': 'Daten © OpenStreetMap-Mitwirkende, ODbL',
    }
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))

    print(f"{len(tiles)} Kacheln Hauptstraßen, {len(local_tiles)} Kacheln Nebenstraßen, "
          f"{stat['main']} + {stat['local']} Wege, {stat['relations']} Abbiegeverbote, "
          f"{sum(len(v) for v in places.values())} Orte, {sum(len(v) for v in pois.values())} Tankstellen/Rasten, "
          f"{size / 1e6:.1f} MB, {time.time() - t0:.0f} s"
          + (f", {stat['ways_incomplete']} Wege ohne vollständige Koordinaten" if stat['ways_incomplete'] else ''))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('src')
    p.add_argument('out')
    p.add_argument('--bbox', help='nur Kacheln, die ganz in s,w,n,e liegen (Ränder eines Auszugs sind unvollständig)')
    p.add_argument('--name', help='Name des Gebiets, zeigt die App bei Punkten außerhalb an (z. B. "Baden-Württemberg")')
    a = p.parse_args()
    box = [float(v) for v in a.bbox.split(',')] if a.bbox else None
    if box and len(box) != 4:
        sys.exit('--bbox braucht vier Werte: s,w,n,e')
    build(a.src, a.out, box, a.name)
