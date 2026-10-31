# Erzeugt App-Icons (Web/PWA) und Quellbilder für @capacitor/assets (Android/iOS).
import math
from pathlib import Path
from PIL import Image, ImageDraw

BG, ROAD, LINE = (10, 10, 11, 255), (229, 37, 42, 255), (255, 255, 255, 255)  # Schwarz, Signalrot, Weiß
ROOT = Path(__file__).resolve().parent.parent

def serpentine(size, scale):
    """Kurvige Straße als Punktliste, mittig, 'scale' = Anteil der Bildgröße."""
    pts = []
    for i in range(601):
        t = i / 600
        y = size * (0.5 + scale * (0.5 - t))
        x = size * (0.5 + scale * 0.32 * math.sin(t * 2.6 * math.pi + 0.3) * (0.55 + 0.45 * t))
        pts.append((x, y))
    return pts

def draw(size, scale, background, rounded):
    ss = 4  # Supersampling gegen Treppchen
    big = size * ss
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if background:
        if rounded: d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=BG)
        else: d.rectangle([0, 0, big, big], fill=BG)
    pts = serpentine(big, scale)
    r = big * scale * 0.08  # Straße aus Kreisen stempeln: glatte Ränder statt Linien-Joins
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=ROAD)
    for a, b in zip(pts[::24], pts[12::24]):  # gestrichelte Mittellinie
        d.line([a, b], fill=LINE, width=int(big * scale * 0.025))
    return img.resize((size, size), Image.LANCZOS)

web = ROOT / 'www' / 'icons'
draw(192, 0.78, True, True).save(web / 'icon-192.png')
draw(512, 0.78, True, True).save(web / 'icon-512.png')
draw(512, 0.62, True, False).save(web / 'icon-maskable-512.png')
draw(180, 0.72, True, False).save(web / 'apple-touch-icon.png')

assets = ROOT / 'assets'
draw(1024, 0.72, True, False).save(assets / 'icon-only.png')
draw(1024, 0.5, False, False).save(assets / 'icon-foreground.png')
Image.new('RGBA', (1024, 1024), BG).save(assets / 'icon-background.png')
splash = Image.new('RGBA', (2732, 2732), BG)
splash.alpha_composite(draw(700, 0.8, False, False), (1016, 1016))
splash.save(assets / 'splash.png')
splash.save(assets / 'splash-dark.png')
print('Icons erzeugt')
