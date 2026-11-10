// Disk-backed JSON cache plus a polite HTTP client. Free sources stay free only
// if we don't hammer them, so every outbound request goes through here.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CACHE_DIR = process.env.CACHE_DIR || join(ROOT, '.cache');
mkdirSync(CACHE_DIR, { recursive: true });

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const FOREVER = 3650 * DAY;

const memory = new Map();
const inflight = new Map();

const MAX_CONCURRENT = 8;
let active = 0;
const waiting = [];

async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export class NotFoundError extends Error {}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 FreeThrow/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404) throw new NotFoundError(`404 ${url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** i));
    }
  }
  throw lastError;
}

const fileFor = (key) => {
  const safe = key.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 10);
  return join(CACHE_DIR, `${safe}-${hash}.json`);
};

function readEntry(key) {
  if (memory.has(key)) return memory.get(key);
  const file = fileFor(key);
  if (!existsSync(file)) return null;
  try {
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeEntry(key, entry) {
  memory.set(key, entry);
  const file = fileFor(key);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entry));
  renameSync(tmp, file);
}

// Returns the cached value when fresh. Otherwise runs `load`; if that fails and
// a stale copy exists, serves the stale copy so an upstream blip doesn't take
// the app down. `ttl` may be a function of the loaded value.
export async function cached(key, ttl, load) {
  const entry = readEntry(key);
  if (entry && Date.now() < entry.expires) return entry.value;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    try {
      const value = await load();
      const life = typeof ttl === 'function' ? ttl(value) : ttl;
      writeEntry(key, { expires: Date.now() + life, saved: Date.now(), value });
      return value;
    } catch (err) {
      if (entry) return entry.value;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

export const getJson = (url) => withSlot(() => fetchJson(url));

export const savedAt = (key) => readEntry(key)?.saved ?? null;
