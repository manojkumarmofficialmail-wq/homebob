// Local server that behaves like Vercel: static files with vercel.json headers,
// plus /api/feedback. Run: npm start  (or MOCK_SUPABASE=1 npm start to test
// feedback without a real database; rows print in this terminal).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +process.env.PORT || 5173;
const config = JSON.parse(await fs.readFile(path.join(root, 'vercel.json'), 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

if (process.env.MOCK_SUPABASE) {
  process.env.SUPABASE_URL = `http://localhost:${port}/__mock_supabase`;
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_local_mock';
}
const { default: feedback } = await import('../api/feedback.js');

// vercel.json "source" patterns → RegExp (enough for the patterns we use).
const rules = config.headers.map((h) => ({ re: new RegExp('^' + h.source.replace(/\./g, '\\.').replace(/\(\\\.\*\)/g, '(.*)') + '$'), headers: h.headers }));

function shim(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const r of rules) if (r.re.test(url.pathname)) for (const h of r.headers) res.setHeader(h.key, h.value);

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();

  if (url.pathname === '/__mock_supabase/rest/v1/feedback') {
    console.log('[mock supabase] insert', raw);
    res.statusCode = 201; return res.end();
  }
  if (url.pathname === '/api/feedback') {
    try { req.body = raw && String(req.headers['content-type']).includes('json') ? JSON.parse(raw) : raw; } catch { req.body = raw; }
    return feedback(req, shim(res));
  }

  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (url.pathname === '/') file = path.join(root, 'index.html');
  try {
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404; res.end('Not found');
  }
}).listen(port, () => console.log(`Homzy on http://localhost:${port}`));
