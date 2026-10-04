// BearBullBeats build: src/ + public/  ->  dist/   (minified, content-hashed, ready for any static host)
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');
const dist = join(root, 'dist');
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

// Public site URL (for canonical links, social previews, sitemap). Auto-detected on the common hosts.
const cfg = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));
const supportUrl = process.env.SUPPORT_URL || cfg.supportUrl || '';
const e = process.env;
let site = e.SITE_URL || e.URL || e.CF_PAGES_URL || (e.VERCEL_PROJECT_PRODUCTION_URL && 'https://' + e.VERCEL_PROJECT_PRODUCTION_URL) || '';
if (!site && e.GITHUB_REPOSITORY) { const [o, r] = e.GITHUB_REPOSITORY.split('/'); site = `https://${o}.github.io/${r}`; }
site = site.replace(/\/+$/, '');
const abs = (p) => (site ? `${site}/${p}` : p);

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), dist, { recursive: true });

// JS: engine + app + service-worker registration become one minified classic script
const js = await transform([src('engine.js'), src('app.js'), src('support.js'), src('register-sw.js')].join('\n;\n'), {
  minify: true, target: 'es2020', legalComments: 'none', charset: 'utf8'
});
const jsName = `assets/app.${hash(js.code)}.js`;
writeFileSync(join(dist, jsName), js.code);

const css = await transform(src('styles.css'), { loader: 'css', minify: true, target: 'es2020' });
const cssName = `assets/style.${hash(css.code)}.css`;
writeFileSync(join(dist, cssName), css.code);

// HTML
let html = src('index.html')
  .replace('%CSS%', cssName).replace('%JS%', jsName)
  .replace('%BODY%', src('body.html').trim())
  .replace('%SUPPORT_URL%', supportUrl || '#support').replace('%SUPPORT_ATTR%', supportUrl ? '' : ' data-unset')
  .replace('<!--CANONICAL-->', site ? `<link rel="canonical" href="${site}/">` : '')
  .replace('<!--OG_URL-->', site ? `<meta property="og:url" content="${site}/">` : '')
  .replace('<!--OG_IMAGE-->', `<meta property="og:image" content="${abs('og.png')}">`)
  .replace('<!--TW_IMAGE-->', `<meta name="twitter:image" content="${abs('og.png')}">`)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><').replace(/\n\s*/g, ' ').trim();
writeFileSync(join(dist, 'index.html'), html);

// robots + sitemap
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n${site ? `Sitemap: ${site}/sitemap.xml\n` : ''}`);
if (site) writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}/</loc></url></urlset>\n`);

// Service worker: precache the app shell, network-first for pages, cache-first for everything else
const shell = ['./', cssName, jsName, 'manifest.webmanifest', 'favicon.ico', 'brand/mark.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const version = hash(shell.join() + js.code + css.code + html);
writeFileSync(join(dist, 'sw.js'), `const V='bearbullbeats-${version}',SHELL=${JSON.stringify(shell)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==V).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(x=>{const c=x.clone();caches.open(V).then(h=>h.put('./',c));return x}).catch(()=>caches.match('./')));
    return;
  }
  e.respondWith(caches.match(r).then(h=>h||fetch(r).then(x=>{if(x.ok){const c=x.clone();caches.open(V).then(h=>h.put(r,c))}return x})));
});
`);

// report
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
console.log(`\nBearBullBeats built -> dist/   (site url: ${site || 'not set, using relative links'})`);
for (const f of walk(dist).sort()) {
  const b = readFileSync(f);
  const text = /\.(js|css|html|svg|json|webmanifest|txt|xml)$/.test(f);
  console.log(`  ${relative(dist, f).padEnd(34)} ${String(b.length).padStart(7)} B${text ? `   gzip ${String(gzipSync(b).length).padStart(6)} B` : ''}`);
}
