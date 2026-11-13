import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const pages = new Set(['/', '/welcome', '/profile', '/preferences', '/review', '/complete', '/report']);
const routes = new Set(['welcome', 'profile', 'preferences', 'review', 'complete']);
const names = new Set(['LCP', 'INP', 'CLS', 'APP_ROUTE_RENDER']);
const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); };
function auth(value, token) {
  const a = Buffer.from(value || ''), b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
function valid(e) {
  return e && names.has(e.name) && routes.has(e.route) && ['hard','soft','app'].includes(e.navigation) &&
    ['mobile','desktop'].includes(e.device) && typeof e.session === 'string' && /^[a-f0-9-]{36}$/.test(e.session) &&
    typeof e.metricId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(e.metricId) &&
    typeof e.value === 'number' && Number.isFinite(e.value) && e.value >= 0 && e.value <= 600000 &&
    (e.name === 'APP_ROUTE_RENDER' ? e.navigation === 'app' : e.navigation !== 'app');
}
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 4096) throw Error('Too large'); }
  return JSON.parse(text);
}
export function createHandler({ db, token, html }) {
  return async (req, res) => {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url, `http://${host}`);
    try {
      if (url.pathname === '/health' && req.method === 'GET') return reply(res, 200, { ok: true });
      if (url.pathname === '/api/events' && req.method === 'POST') {
        if (!req.headers.origin || new URL(req.headers.origin).host !== host) return reply(res, 403, { error: 'Origin rejected' });
        if (Number(req.headers['content-length'] || 0) > 4096) return reply(res, 413, { error: 'Too large' });
        let e;
        try { e = await body(req); } catch { return reply(res, 400, { error: 'Invalid or oversized JSON' }); }
        if (!valid(e)) return reply(res, 400, { error: 'Invalid event' });
        await db.query(`INSERT INTO rum_events (session, metric_id, name, value, route, navigation, device)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (session, metric_id) DO UPDATE SET value=EXCLUDED.value, recorded_at=NOW()`,
          [e.session,e.metricId,e.name,e.value,e.route,e.navigation,e.device]);
        return reply(res, 202, { ok: true });
      }
      if (url.pathname === '/api/report' && req.method === 'GET') {
        if (!auth(req.headers.authorization, token)) return reply(res, 401, { error: 'Unauthorized' });
        const days = url.searchParams.get('days') === '7' ? 7 : 30;
        const { rows } = await db.query(`SELECT name, value, route, navigation, device, recorded_at
          FROM rum_events WHERE recorded_at >= NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY recorded_at DESC LIMIT 5001`, [days]);
        return reply(res, 200, { days, capped: rows.length > 5000, events: rows.slice(0, 5000) });
      }
      if (req.method === 'GET' && pages.has(url.pathname)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        return res.end(html);
      }
      return reply(res, 404, { error: 'Not found' });
    } catch (error) { console.error('Request failed:', error); return reply(res, 500, { error: 'Server error' }); }
  };
}
export async function start() {
  if (!process.env.DATABASE_URL || !process.env.ADMIN_TOKEN) throw Error('DATABASE_URL and ADMIN_TOKEN must be set');
  const { default: pg } = await import('pg');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  await db.query(`CREATE TABLE IF NOT EXISTS rum_events (
    session TEXT NOT NULL, metric_id TEXT NOT NULL, name TEXT NOT NULL, value DOUBLE PRECISION NOT NULL,
    route TEXT NOT NULL, navigation TEXT NOT NULL, device TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (session, metric_id))`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_rum_recorded_at ON rum_events(recorded_at)');
  const html = await readFile(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
  const port = Number(process.env.PORT || 10000);
  const server = http.createServer(createHandler({ db, token: process.env.ADMIN_TOKEN, html }));
  server.listen(port, '0.0.0.0', () => console.log(`RUM SPA listening on ${port}`));
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start().catch(error => { console.error(error); process.exitCode = 1; });
