#!/usr/bin/env node
/*
  Reads every playlist in playlists.json and saves its videos (in playlist order)
  to data/playlists.json. Tries the playlist web page (up to 100 videos, then
  follows "load more" pages); if that is refused it falls back to the playlist's
  RSS feed, which only ever holds the latest 15. A playlist that fails keeps its
  previously saved list, so one bad run never loses anything.
*/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'playlists.json');
const OUT = path.join(ROOT, 'data', 'playlists.json');
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-GB,en;q=0.9',
  Cookie: 'SOCS=CAI; CONSENT=YES+1',
};
const log = (...a) => console.log(...a);

function* walk(o) {
  if (Array.isArray(o)) { for (const x of o) yield* walk(x); }
  else if (o && typeof o === 'object') { yield o; for (const k in o) yield* walk(o[k]); }
}
const text = (t) => (t && (t.simpleText || (t.runs || []).map((r) => r.text).join(''))) || '';

const clock = (s) => { const p = String(s).split(':').map(Number); return p.some(isNaN) ? null : p.reduce((a, x) => a * 60 + x, 0); };
function collect(json, items, seen) {
  let token = null;
  for (const o of walk(json)) {
    const r = o.playlistVideoRenderer;
    if (r && r.videoId && !seen.has(r.videoId)) {
      seen.add(r.videoId);
      items.push({ id: r.videoId, t: text(r.title), d: Number(r.lengthSeconds) || null, ok: r.isPlayable !== false });
    }
    const l = o.lockupViewModel;
    if (l && l.contentId && /VIDEO/.test(l.contentType || 'VIDEO') && !seen.has(l.contentId)) {
      seen.add(l.contentId);
      let d = null;
      for (const x of walk(l.contentImage)) {
        const tx = x.thumbnailBadgeViewModel?.text;
        if (tx && /^\d+(:\d{2}){1,2}$/.test(tx)) d = clock(tx);
      }
      items.push({ id: l.contentId, t: l.metadata?.lockupMetadataViewModel?.title?.content || '', d, ok: true });
    }
    const c = o.continuationCommand?.token;
    if (c) token = c;
  }
  return token;
}

async function viaPage(id) {
  const res = await fetch('https://www.youtube.com/playlist?list=' + id + '&hl=en-GB', { headers: HEADERS });
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('page ' + res.status + ' had no data (' + html.length + ' bytes)');
  const data = JSON.parse(m[1]);
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20240101.00.00';
  const title = data.metadata?.playlistMetadataRenderer?.title || '';
  const items = [], seen = new Set();
  let token = collect(data, items, seen);
  for (let n = 0; token && key && n < 40; n++) {
    const r = await fetch('https://www.youtube.com/youtubei/v1/browse?key=' + key, {
      method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en-GB' } }, continuation: token }),
    });
    if (!r.ok) throw new Error('continuation ' + r.status);
    token = collect(await r.json(), items, seen);
  }
  if (!items.length) throw new Error('page had no videos');
  return { title, items, source: 'page' };
}

async function viaRss(id) {
  const res = await fetch('https://www.youtube.com/feeds/videos.xml?playlist_id=' + id, { headers: HEADERS });
  if (!res.ok) throw new Error('rss ' + res.status);
  const xml = await res.text();
  const items = [...xml.matchAll(/<entry>.*?<yt:videoId>([^<]+)<\/yt:videoId>.*?<title>([^<]*)<\/title>/gs)]
    .map((m) => ({ id: m[1], t: m[2].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'), d: null, ok: true }));
  const title = ((xml.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/&amp;/g, '&');
  if (!items.length) throw new Error('rss had no entries');
  return { title, items, source: 'rss (latest 15 only)' };
}

const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));
let prev = {};
try { prev = JSON.parse(await readFile(OUT, 'utf8')).lists || {}; } catch {}
const lists = {};
for (const id of cfg.playlists) {
  let got = null;
  for (const f of [viaPage, viaRss]) {
    try { got = await f(id); break; } catch (e) { log('! ' + id + ' ' + f.name + ': ' + e.message); }
  }
  if (got && (!prev[id] || got.items.length >= prev[id].items.length || got.source === 'page')) {
    lists[id] = { ...got, fetched: new Date().toISOString() };
    log(id, got.source, got.items.length + ' videos', JSON.stringify(got.title));
  } else if (prev[id]) { lists[id] = prev[id]; log(id, 'kept previous list of', prev[id].items.length); }
  else log(id, 'NOTHING');
  await new Promise((r) => setTimeout(r, 800));
}
/* ---- "drips": a channel's whole back catalogue, replayed oldest to newest from a chosen video ---- */
let prevDrips = {};
try { prevDrips = JSON.parse(await readFile(OUT, 'utf8')).drips || {}; } catch {}
const drips = {};
const isShort = (i) => (i.d != null && i.d <= 61) || /#shorts?\b/i.test(i.t);
for (const dr of cfg.drips || []) {
  if (dr.playlist) {                       // an ordered playlist: explicit opening videos, then everything from one video towards the newest, then the rest
    try {
      const got = await viaPage(dr.playlist);
      const list = got.items.filter((i) => i.ok && !isShort(i));          // newest first
      const byId = new Map(list.map((i) => [i.id, i]));
      const used = new Set(), q = [];
      const take = (i) => { if (i && !used.has(i.id)) { used.add(i.id); q.push(i); } };
      for (const id of dr.before || []) {      // single videos from outside the playlist, shown before everything else
        let t = id, d = null;
        try { const o = await (await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { headers: HEADERS })).json(); t = o.title || t; } catch (e) { log('! no title for ' + id + ': ' + e.message); }
        try { const pg = await (await fetch('https://www.youtube.com/watch?v=' + id, { headers: HEADERS })).text(); d = Number((pg.match(/"lengthSeconds":"(\d+)"/) || [])[1]) || null; } catch {}
        take({ id, t, d, ok: true });
      }
      (dr.first || []).forEach((id) => take(byId.get(id)));
      if (dr.fromId) {
        const at = list.findIndex((i) => i.id === dr.fromId);
        if (at < 0) throw new Error('start video ' + dr.fromId + ' not found');
        list.slice(0, at + 1).reverse().forEach(take);
      }
      (dr.then || []).forEach((id) => take(byId.get(id)));
      list.forEach(take);
      drips[dr.key] = { title: got.title, total: list.length, items: q, fetched: new Date().toISOString() };
      log('drip', dr.key, q.length, 'videos from the playlist (' + got.items.length + ' listed, Shorts removed)');
    } catch (e) {
      log('! drip ' + dr.key + ': ' + e.message);
      if (prevDrips[dr.key]) { drips[dr.key] = prevDrips[dr.key]; log('kept previous drip list'); }
    }
    continue;
  }
  try {
    const page = await (await fetch('https://www.youtube.com/@' + dr.handle, { headers: HEADERS })).text();
    const cid = (page.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || page.match(/"externalId":"(UC[\w-]{22})"/) || page.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
    if (!cid) throw new Error('no channel ID for @' + dr.handle);
    let got = null, lastErr;
    for (const pre of ['UULF', 'UU']) {      // UULF = long videos only (no Shorts or live streams)
      try { got = await viaPage(pre + cid.slice(2)); break; } catch (e) { lastErr = e; }
    }
    if (!got) throw lastErr;
    const newestFirst = got.items.filter((i) => i.ok);
    const at = newestFirst.findIndex((i) => i.id === dr.from);
    if (at < 0) throw new Error('start video ' + dr.from + ' not found among ' + newestFirst.length + ' videos');
    drips[dr.key] = { title: got.title, total: newestFirst.length, items: newestFirst.slice(0, at + 1).reverse(), fetched: new Date().toISOString() };
    log('drip', dr.key, newestFirst.length + ' videos on the channel;', at + 1, 'from the start video to the newest');
  } catch (e) {
    log('! drip ' + dr.key + ': ' + e.message);
    if (prevDrips[dr.key]) { drips[dr.key] = prevDrips[dr.key]; log('kept previous drip list'); }
  }
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), start: cfg.start || [], order: cfg.playlists, lists, drips }, null, 1) + '\n');
