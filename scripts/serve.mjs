// Tiny zero-dependency static server for previewing dist/ locally:  npm start
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let f = join(dist, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { f = join(dist, '404.html'); res.statusCode = 404; }
  const ext = extname(f);
  let body = readFileSync(f);
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', f.includes('assets') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (/\.(html|js|css|svg|json|webmanifest|txt|xml)$/.test(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) { body = gzipSync(body); res.setHeader('Content-Encoding', 'gzip'); }
  res.end(body);
}).listen(port, () => console.log(`BearBullBeats on http://localhost:${port}`));
