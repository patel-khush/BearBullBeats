# BearBullBeats

Audio-reactive candlestick and line-graph visualizer. Nine frequency bands, four views, runs 100% in the browser. No backend, no tracking, no dependencies at runtime (about 15 KB gzipped in total).

- **Views:** grid of candles, single candle chart, grid of lines, single line graph (two tiny sliders, bottom right)
- **Audio:** mid/side stereo separation, drum transient detection, 2 s rolling auto-scaling
- **Keys:** `V` layout, `L` candles/line, `1`-`9` pick a band, `F` fullscreen

## Project layout

```
src/            the source you edit (index.html, body.html, styles.css, engine.js, app.js)
public/         copied as-is (icons, manifest, og.png, _headers, 404.html)
scripts/        build.mjs (minify + hash + service worker), serve.mjs (preview), make-brand.py
brand/          logo-source.png, the original artwork every logo, icon and social image is made from
site.config.json  site name and the Support Developer link
dist/           the finished site, ready to host anywhere (already built for you)
```

## Run locally

```bash
npm install
npm start        # builds, then serves http://localhost:5173
```

## Deploy (pick one, all free)

Microphone and tab-audio capture only work on **https** (or localhost), which every host below gives you automatically.

**GitHub Pages (works from the GitHub web UI)**
1. Create a repo, then *Add file -> Upload files* and drop in everything from this folder.
2. *Settings -> Pages -> Source: GitHub Actions*.
3. Every push to `main` builds and deploys. Your site: `https://<user>.github.io/<repo>/`.

**Netlify** - *Add new site -> Import from Git*, or just drag the `dist/` folder onto app.netlify.com/drop. `netlify.toml` is already set.

**Vercel** - *Add New -> Project -> import the repo*. `vercel.json` is already set.

**Cloudflare Pages** - *Create project -> connect the repo*. Build command `npm run build`, output directory `dist`.

The build detects your public URL on these hosts for canonical links and the social preview. On any other host set `SITE_URL=https://your-domain.com` before `npm run build`.

## Support Developer button

The long button at the top right opens the link in `site.config.json`:

```json
{ "name": "BearBullBeats", "supportUrl": "https://your-link-here" }
```

Put your tip jar, Patreon, Ko-fi, UPI page or any URL there and rebuild. You can also set it per deploy with the `SUPPORT_URL` environment variable. While it is empty, the button shows "Support link coming soon" instead of going nowhere.

## Logo and icons

Everything visual comes from `brand/logo-source.png`. To swap the logo, replace that file and run `python3 scripts/make-brand.py` (needs Pillow and numpy), then `npm run build`.

## Editing

Change files in `src/`, then `npm run build` (or let the host/Actions do it). Do not hand-edit `dist/`; it is regenerated.

## Notes

- Offline: after the first visit the app works without a connection (service worker, https/localhost only).
- Security: strict Content-Security-Policy (no inline scripts, no third-party requests), plus hardening headers on hosts that read `_headers` / `vercel.json`.
- Tab audio: in Chrome pick a tab and tick "Share tab audio". Mic needs permission once.
