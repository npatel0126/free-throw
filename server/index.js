// A zero-dependency HTTP server: JSON API plus the static front end.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { board, currentSlateDate, dvp, gamesDate, player, players, slate } from './engine.js';
import { gameLines } from './lines.js';
import { trackRecord } from './backtest.js';
import { etDate } from './espn.js';

const PUBLIC = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function send(req, res, status, body, type) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (payload.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    payload = gzipSync(payload);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers);
  res.end(payload);
}

const json = (req, res, data, status = 200) => send(req, res, status, JSON.stringify(data), TYPES['.json']);

const validDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);

// The track record reruns off finished games, so it only builds in the background.
const record = { data: null, job: null, error: null };
function loadRecord() {
  if (!record.job) {
    record.job = trackRecord(etDate())
      .then((data) => {
        record.data = data;
        record.error = null;
      })
      .catch((err) => {
        record.error = err.message;
        console.error('track record failed', err);
      })
      .finally(() => {
        record.job = null;
      });
  }
}

async function api(req, res, url) {
  const path = url.pathname;
  if (path === '/api/board') {
    const date = validDate(url.searchParams.get('date')) ?? (await currentSlateDate());
    return json(req, res, { date, ...board(date) });
  }
  if (path === '/api/slate') {
    const date = validDate(url.searchParams.get('date')) ?? (await gamesDate());
    return json(req, res, await slate(date));
  }
  if (path === '/api/lines') {
    const date = validDate(url.searchParams.get('date')) ?? (await currentSlateDate());
    return json(req, res, { date, ...(await gameLines(date)) });
  }
  if (path === '/api/dvp') {
    const raw = url.searchParams.get('window');
    const window = raw === '5' || raw === '10' ? Number(raw) : null;
    return json(req, res, await dvp(etDate(), window));
  }
  if (path === '/api/players') return json(req, res, await players());
  const match = path.match(/^\/api\/player\/(\d+)$/);
  if (match) return json(req, res, await player(match[1]));
  if (path === '/api/record') {
    if (!record.data) {
      loadRecord();
      // A saved report loads almost instantly, so give it a moment before saying "building".
      await Promise.race([record.job, new Promise((resolve) => setTimeout(resolve, 1200))]);
    }
    return json(req, res, { data: record.data, building: !!record.job, error: record.error });
  }
  return json(req, res, { error: 'Not found' }, 404);
}

async function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + sep)) return send(req, res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(file);
    return send(req, res, 200, body, TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    return send(req, res, 404, 'Not found', 'text/plain');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error(req.url, err);
    if (!res.headersSent) json(req, res, { error: 'The data source did not respond. Try again shortly.' }, 502);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Free Throw is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  // Warm the board so the first visitor doesn't wait on a cold start.
  currentSlateDate().then(board).catch((err) => console.error('warmup failed', err));
});
