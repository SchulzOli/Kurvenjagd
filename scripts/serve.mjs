// Testserver für die Entwicklung: liefert www/ (App), unter /data/ die Testdaten aus data/ (Straßenpakete,
// Karte) und unter /site/ die Website. Kann Teilanfragen (Range, nötig für PMTiles) und CORS, damit auch der
// Android-Emulator die Daten per `adb reverse` von http://127.0.0.1:8765/data/ laden kann –
// so wie die echte App sie später vom eigenen Speicher (CDN) holt.
//
//   node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = +(process.argv[2] || 8765);
const ROOTS = [['/data/', resolve('data')], ['/site/', resolve('site')], ['/', resolve('www')]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.gz': 'application/gzip', '.pmtiles': 'application/octet-stream' };

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [prefix, dir] = ROOTS.find(([p]) => url.startsWith(p));
  let file = normalize(join(dir, url.slice(prefix.length)));
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
  let st;
  try { st = statSync(file); if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); } }
  catch { res.writeHead(404); return res.end('nicht gefunden'); }

  const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache', ETag: `"${st.size}-${st.mtimeMs | 0}"` };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : st.size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Kurvenjagd-Testserver: http://localhost:${port} (Daten aus data/)`));
