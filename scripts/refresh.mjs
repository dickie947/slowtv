#!/usr/bin/env node
/*
  SlowTV feed refresher.

  Run daily by GitHub Actions (or by hand: `node scripts/refresh.mjs`).
  For every channel in channels.json it:
    1. works out the channel's ID from its @handle (cached in data/state.json),
    2. reads the channel's public RSS feed (the latest ~15 uploads),
    3. drops Shorts, live streams and anything older than 30 days,
    4. looks up each new video's running time,
    5. merges the result into data/feed.json, which the web page reads.

  No API key and no packages needed. Node 18 or newer.
*/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), '..');
const FILES = {
  channels: path.join(ROOT, 'channels.json'),
  state: path.join(ROOT, 'data', 'state.json'),
  feed: path.join(ROOT, 'data', 'feed.json'),
};

export const KEEP_DAYS = 30;
const DAY = 864e5;
const RETRY_DURATION_LIMIT = 30; // how many missing running times to retry per run

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-GB,en;q=0.9',
  Cookie: 'SOCS=CAI; CONSENT=YES+1', // skips the cookie-consent interstitial
};

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- parsing helpers (exported so they can be tested) ---------- */

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });
}

export function cleanDescription(text = '') {
  let s = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  if (s.length > 400) {
    s = s.slice(0, 400).replace(/\s+\S*$/, '') + '…';
  }
  return s;
}

export function parseFeed(xml) {
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const nameMatch = head.match(/<title>([\s\S]*?)<\/title>/);
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const pick = (rx) => {
      const r = e.match(rx);
      return r ? decodeEntities(r[1]).trim() : '';
    };
    const id = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!id) continue;
    entries.push({
      id,
      title: pick(/<title>([\s\S]*?)<\/title>/),
      published: pick(/<published>([^<]+)<\/published>/),
      link: pick(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || pick(/<link[^>]*href="([^"]+)"/),
      description: pick(/<media:description>([\s\S]*?)<\/media:description>/),
    });
  }
  return { name: nameMatch ? decodeEntities(nameMatch[1]).trim() : '', entries };
}

export function extractChannelId(html) {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
    /"browseId":"(UC[\w-]{22})"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

export function parseWatchPage(html, id) {
  const m = html.match(
    new RegExp(`"videoDetails":\\{"videoId":"${id}"[\\s\\S]{0,4000}?"lengthSeconds":"(\\d+)"`)
  );
  const duration = m ? Number(m[1]) : null;
  const live =
    /"isUpcoming":true/.test(html) || /"isLive":true/.test(html) || duration === 0;
  return { duration, live };
}

/* ---------- network helpers ---------- */

async function getText(url, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.text();
    } catch (err) {
      last = err;
      if (i < retries) await sleep(1000 * (i + 1));
    }
  }
  throw last;
}

async function resolveChannelId(handle) {
  const html = await getText(`https://www.youtube.com/@${encodeURIComponent(handle)}`);
  const id = extractChannelId(html);
  if (!id) throw new Error(`could not find a channel ID on the page for @${handle}`);
  return id;
}

async function isShort(id) {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${id}`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    return r.status === 200; // regular videos redirect to /watch
  } catch {
    return false;
  }
}

async function inspectVideo(id) {
  const out = { short: false, live: false, duration: null };
  try {
    const html = await getText(`https://www.youtube.com/watch?v=${id}`, 1);
    const info = parseWatchPage(html, id);
    out.duration = info.duration;
    out.live = info.live;
  } catch {
    /* running time stays unknown; the page copes with that */
  }
  if (!out.live && out.duration != null && out.duration <= 185) {
    out.short = await isShort(id);
  }
  return out;
}

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/* ---------- main ---------- */

export async function main({ now = Date.now() } = {}) {
  const cfg = await readJson(FILES.channels, { channels: [] });
  const state = await readJson(FILES.state, { ids: {}, skip: {} });
  state.ids ||= {};
  state.skip ||= {};
  const prev = await readJson(FILES.feed, { channels: [], videos: [] });
  const cutoff = now - KEEP_DAYS * DAY;

  const known = new Map((prev.videos || []).map((v) => [v.id, v]));
  const channels = [];
  const fresh = [];
  let ok = 0;
  let failed = 0;
  let shorts = 0;

  for (const entry of cfg.channels || []) {
    const handle = String(entry.handle || '').replace(/^@/, '');
    if (!handle) continue;
    try {
      let id = entry.id || state.ids[handle];
      if (!id) {
        id = await resolveChannelId(handle);
        state.ids[handle] = id;
        log(`  resolved @${handle} -> ${id}`);
      }
      const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
      const feed = parseFeed(xml);
      channels.push({
        id,
        handle,
        name: entry.name || feed.name || handle,
        group: entry.group || 'Other',
      });
      ok++;

      for (const e of feed.entries) {
        const ts = Date.parse(e.published);
        if (!(ts >= cutoff)) continue;
        if (state.skip[e.id]) continue;
        if (/\/shorts\//.test(e.link)) {
          state.skip[e.id] = e.published;
          shorts++;
          continue;
        }
        const existing = known.get(e.id);
        if (existing) {
          existing.t = e.title;
          existing.x = cleanDescription(e.description);
        } else {
          fresh.push({
            id: e.id,
            c: id,
            t: e.title,
            p: e.published,
            d: null,
            x: cleanDescription(e.description),
          });
        }
      }
    } catch (err) {
      failed++;
      log(`! @${handle}: ${err.message}`);
      const old = (prev.channels || []).find(
        (c) => String(c.handle).toLowerCase() === handle.toLowerCase()
      );
      if (old) channels.push(old); // keep its older programmes listed
    }
  }

  if (ok === 0) throw new Error('No channel could be fetched; leaving the existing guide untouched.');

  // Look up running times (and catch Shorts / live streams) for new videos,
  // plus a few older ones whose running time failed to load last time.
  const retry = [...known.values()]
    .filter((v) => v.d == null && Date.parse(v.p) >= cutoff)
    .slice(0, RETRY_DURATION_LIMIT);
  const toInspect = [...fresh, ...retry];
  await pool(toInspect, 3, async (v) => {
    const info = await inspectVideo(v.id);
    if (info.live) return; // upcoming or live right now: look again tomorrow
    if (info.short) {
      state.skip[v.id] = v.p;
      known.delete(v.id);
      shorts++;
      return;
    }
    if (info.duration != null) v.d = info.duration;
    known.set(v.id, v);
  });
  // Anything fresh that was skipped as live stays out; everything else is in `known`.

  const keep = new Set(channels.map((c) => c.id));
  const videos = [...known.values()]
    .filter((v) => keep.has(v.c) && Date.parse(v.p) >= cutoff)
    .sort((a, b) => Date.parse(b.p) - Date.parse(a.p));

  for (const k of Object.keys(state.skip)) {
    if (Date.parse(state.skip[k]) < cutoff - 15 * DAY) delete state.skip[k];
  }

  await mkdir(path.dirname(FILES.feed), { recursive: true });
  const feedOut = { generated: new Date(now).toISOString(), days: KEEP_DAYS, channels, videos };
  await writeFile(FILES.feed, JSON.stringify(feedOut, null, 1) + '\n');
  await writeFile(FILES.state, JSON.stringify(state, null, 1) + '\n');

  log(
    `Done: ${ok} channel(s) fetched, ${failed} failed, ${fresh.length} new, ` +
      `${shorts} Short(s)/skipped, ${videos.length} programme(s) in the guide.`
  );
  return feedOut;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
