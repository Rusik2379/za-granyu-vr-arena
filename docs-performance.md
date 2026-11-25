# Static asset preparation

`node scripts/build-pages.mjs` regenerates `dist/site.css` from the existing stylesheets, in the same cascade order, then prepares the GitHub Pages files. Edit the original stylesheets rather than the generated bundle. The four application pages use one stylesheet instead of eight.

To regenerate image sizes and WOFF2 fonts from the retained originals:

```sh
python -m pip install Pillow fonttools brotli
python scripts/optimize-media.py
node scripts/build-pages.mjs
```

The original PNG and TTF files remain available for existing cached pages and future edits. Current pages use WebP images, smaller responsive variants, and actual WOFF2 fonts. QR image optimization preserves its pixels. Image generation does not run during a normal Pages build.

Asset sizes measured during this change (before HTTP compression):

| Assets | Before | After |
| --- | ---: | ---: |
| Seven supplied photographs and posters, primary variants | 16,830,250 B | 1,518,082 B |
| Header and studio logos | 2,047,753 B | 142,506 B |
| Six fonts | 512,560 B | 163,328 B |

These are asset byte reductions, not measured page-load timings. Responsive variants can reduce transfers further. Videos remain outside the page until a game review is opened and do not preload before playback. The map and images below the first screen use lazy loading.
