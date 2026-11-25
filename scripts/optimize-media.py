"""Prepare web assets from retained originals. Requires Pillow, fonttools and brotli."""
from pathlib import Path
from io import BytesIO
import json
from PIL import Image, ImageOps
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'dist/assets'
report = []


def webp(source, width, quality=86, suffix='', lossless=False):
    target = source.with_name(source.stem + suffix + '.webp')
    with Image.open(source) as original:
        picture = ImageOps.exif_transpose(original)
        picture.thumbnail((width, 10000), Image.Resampling.LANCZOS)
        picture.save(target, 'WEBP', quality=quality, method=6, lossless=lossless)
    if not suffix:
        report.append({'asset': str(source.relative_to(ASSETS)), 'before': source.stat().st_size,
                       'after': target.stat().st_size})


for name in ['birthday-party', 'corporate-team', 'corporate-battle']:
    source = ASSETS / (name + '.png')
    webp(source, 1448)
    webp(source, 768, suffix='-768')

for source in (ASSETS / 'birthday').glob('*.png'):
    webp(source, 900, quality=88)
    webp(source, 450, quality=88, suffix='-450')

webp(ASSETS / 'za-granyu-logo-transparent.png', 600, lossless=True)
webp(ASSETS / 'sibsoft-logo.png', 256, lossless=True)

for source in (ASSETS / 'games').glob('*.webp'):
    if source.stem.endswith(('-450', '-900')):
        continue
    webp(source, 900, suffix='-900')
    webp(source, 450, suffix='-450')

# QR pixels stay identical; only the PNG encoding changes.
qr = ASSETS / 'max-contact-qr.png'
with Image.open(qr) as picture:
    encoded = BytesIO()
    picture.save(encoded, format='PNG', optimize=True)
    if len(encoded.getvalue()) < qr.stat().st_size:
        qr.write_bytes(encoded.getvalue())

fonts = ASSETS / 'fonts'
fonts.mkdir(exist_ok=True)
for index, name in enumerate(['manrope-400', 'manrope-500', 'manrope-600', 'manrope-700', 'manrope-800', 'russo-one']):
    source = ASSETS / f'font-{index}.woff2'
    target = fonts / (name + '.woff2')
    font = TTFont(source, recalcTimestamp=False)
    original_glyphs = font.getBestCmap()
    font.flavor = 'woff2'
    font.save(target)
    assert TTFont(target).getBestCmap() == original_glyphs
    report.append({'asset': source.name, 'before': source.stat().st_size, 'after': target.stat().st_size})

result = ROOT.parent / '.work/performance-assets.json'
result.parent.mkdir(exist_ok=True)
result.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
