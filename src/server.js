import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const pages = new Set(['/', '/welcome', '/profile', '/preferences', '/review', '/complete', '/report']);
const routes = new Set(['welcome', 'profile', 'preferences', 'review', 'complete']);
const names = new Set(['LCP', 'INP', 'CLS', 'APP_ROUTE_RENDER']);
const idPattern = /^[a-f0-9-]{36}$/;
const shortLabel = /^[A-Za-z0-9 ._-]{1,40}$/;
const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); };
function auth(value, token) {
  const a = Buffer.from(value || ''), b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
function valid(e) {
  return e && names.has(e.name) && routes.has(e.route) && ['hard','soft','app'].includes(e.navigation) &&
    ['mobile','tablet','desktop'].includes(e.device) && typeof e.session === 'string' && idPattern.test(e.session) &&
    typeof e.viewId === 'string' && idPattern.test(e.viewId) &&
    typeof e.metricId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(e.metricId) &&
    typeof e.value === 'number' && Number.isFinite(e.value) && e.value >= 0 && e.value <= 600000 &&
    (e.name === 'APP_ROUTE_RENDER' ? e.navigation === 'app' : e.navigation !== 'app');
}
function validView(e) {
  return e && idPattern.test(e.viewId || '') && idPattern.test(e.visitId || '') &&
    idPattern.test(e.session || '') && idPattern.test(e.testerId || '') &&
    routes.has(e.route) && ['hard','soft','app'].includes(e.navigation) &&
    ['mobile','tablet','desktop'].includes(e.device) && shortLabel.test(e.browser || '') &&
    shortLabel.test(e.browserVersion || '') && typeof e.softSupported === 'boolean' &&
    (e.clsSupported === undefined || typeof e.clsSupported === 'boolean') &&
    typeof e.clientTime === 'string' && /^\d{4}-\d\d-\d\dT/.test(e.clientTime) && !Number.isNaN(Date.parse(e.clientTime));
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
      if (url.pathname === '/api/views' && req.method === 'POST') {
        if (!req.headers.origin || new URL(req.headers.origin).host !== host) return reply(res, 403, { error: 'Origin rejected' });
        let e;
        try { e = await body(req); } catch { return reply(res, 400, { error: 'Invalid or oversized JSON' }); }
        if (e?.action === 'library' && idPattern.test(e.visitId || '') && ['loaded','failed'].includes(e.libraryStatus)) {
          await db.query('UPDATE rum_views SET library_status=$2 WHERE visit_id=$1', [e.visitId,e.libraryStatus]);
          return reply(res, 202, { ok: true });
        }
        if (!['start','end'].includes(e?.action) || !validView(e) || !['pending','loaded','failed'].includes(e.libraryStatus)) return reply(res, 400, { error: 'Invalid view' });
        await db.query(`INSERT INTO rum_views
          (view_id, visit_id, session_id, tester_id, route, navigation, browser, browser_version, device, soft_supported, client_time, library_status, ended_at, cls_supported)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (view_id) DO UPDATE SET ended_at=COALESCE(rum_views.ended_at, EXCLUDED.ended_at),
          library_status=CASE WHEN rum_views.library_status='pending' THEN EXCLUDED.library_status ELSE rum_views.library_status END`,
          [e.viewId,e.visitId,e.session,e.testerId,e.route,e.navigation,e.browser,e.browserVersion,e.device,e.softSupported,e.clientTime,e.libraryStatus,e.action === 'end' ? new Date() : null,e.clsSupported ?? null]);
        return reply(res, 202, { ok: true });
      }
      if (url.pathname === '/api/events' && req.method === 'POST') {
        if (!req.headers.origin || new URL(req.headers.origin).host !== host) return reply(res, 403, { error: 'Origin rejected' });
        if (Number(req.headers['content-length'] || 0) > 4096) return reply(res, 413, { error: 'Too large' });
        let e;
        try { e = await body(req); } catch { return reply(res, 400, { error: 'Invalid or oversized JSON' }); }
        if (!valid(e)) return reply(res, 400, { error: 'Invalid event' });
        await db.query(`INSERT INTO rum_events (session, metric_id, name, value, route, navigation, device, view_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (session, metric_id) DO UPDATE SET value=EXCLUDED.value, view_id=EXCLUDED.view_id, recorded_at=NOW()`,
          [e.session,e.metricId,e.name,e.value,e.route,e.navigation,e.device,e.viewId]);
        return reply(res, 202, { ok: true });
      }
      if (url.pathname === '/api/report' && req.method === 'GET') {
        if (!auth(req.headers.authorization, token)) return reply(res, 401, { error: 'Unauthorized' });
        const days = url.searchParams.get('days') === '7' ? 7 : 30;
        const { rows } = await db.query(`SELECT name, value, route, navigation, device, view_id, recorded_at
          FROM rum_events WHERE recorded_at >= NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY recorded_at DESC LIMIT 5001`, [days]);
        const views = await db.query(`SELECT view_id, visit_id, session_id, tester_id, route, navigation,
          browser, browser_version, device, soft_supported, cls_supported, client_time, library_status, started_at, ended_at
          FROM rum_views WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY started_at DESC LIMIT 5001`, [days]);
        return reply(res, 200, { days, schemaVersion: 2, capped: rows.length > 5000 || views.rows.length > 5000,
          events: rows.slice(0, 5000), views: views.rows.slice(0, 5000) });
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
  await db.query('ALTER TABLE rum_events ADD COLUMN IF NOT EXISTS view_id TEXT');
  await db.query(`CREATE TABLE IF NOT EXISTS rum_views (
    view_id TEXT PRIMARY KEY, visit_id TEXT NOT NULL, session_id TEXT NOT NULL, tester_id TEXT NOT NULL,
    route TEXT NOT NULL, navigation TEXT NOT NULL, browser TEXT NOT NULL, browser_version TEXT NOT NULL,
    device TEXT NOT NULL, soft_supported BOOLEAN NOT NULL, cls_supported BOOLEAN, client_time TIMESTAMPTZ NOT NULL,
    library_status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ)`);
  await db.query("ALTER TABLE rum_views ADD COLUMN IF NOT EXISTS library_status TEXT NOT NULL DEFAULT 'pending'");
  await db.query('ALTER TABLE rum_views ADD COLUMN IF NOT EXISTS cls_supported BOOLEAN');
  await db.query('CREATE INDEX IF NOT EXISTS idx_rum_views_started_at ON rum_views(started_at)');
  const html = await readFile(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
  const port = Number(process.env.PORT || 10000);
  const server = http.createServer(createHandler({ db, token: process.env.ADMIN_TOKEN, html }));
  server.listen(port, '0.0.0.0', () => console.log(`RUM SPA listening on ${port}`));
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start().catch(error => { console.error(error); process.exitCode = 1; });
