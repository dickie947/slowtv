import { writeFile } from 'node:fs/promises';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };
const log = (...a) => console.log(...a);
function* walk(o) { if (Array.isArray(o)) { for (const x of o) yield* walk(x); } else if (o && typeof o === 'object') { yield o; for (const k in o) yield* walk(o[k]); } }
const txt = t => (t && (t.simpleText || (t.runs || []).map(r => r.text).join(''))) || '';
const clock = s => { const p = String(s).split(':').map(Number); return p.some(isNaN) ? null : p.reduce((a, x) => a * 60 + x, 0); };
function collect(json, items, seen) {
  let token = null;
  for (const o of walk(json)) {
    const l = o.lockupViewModel;
    if (l && l.contentId && /VIDEO/.test(l.contentType || 'VIDEO') && !seen.has(l.contentId)) {
      seen.add(l.contentId); let d = null;
      for (const x of walk(l.contentImage)) { const tx = x.thumbnailBadgeViewModel?.text; if (tx && /^\d+(:\d{2}){1,2}$/.test(tx)) d = clock(tx); }
      items.push({ id: l.contentId, t: l.metadata?.lockupMetadataViewModel?.title?.content || '', d });
    }
    const r = o.playlistVideoRenderer || o.videoRenderer;
    if (r && r.videoId && !seen.has(r.videoId)) { seen.add(r.videoId); items.push({ id: r.videoId, t: txt(r.title), d: clock(txt(r.lengthText)) || Number(r.lengthSeconds) || null, snip: (r.detailedMetadataSnippets || []).map(s => txt(s.snippetText)).join(' | ').slice(0, 300), when: txt(r.publishedTimeText) }); }
    const c = o.continuationCommand?.token; if (c) token = c;
  }
  return token;
}
async function page(url) {
  const res = await fetch(url, { headers: H }); const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error(url + ' ' + res.status + ' no data');
  return { data: JSON.parse(m[1]), html };
}
async function all(url, max = 60) {
  const { data, html } = await page(url);
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1], ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20240101.00.00';
  const items = [], seen = new Set(); let token = collect(data, items, seen);
  for (let n = 0; token && key && n < max; n++) {
    const r = await fetch('https://www.youtube.com/youtubei/v1/browse?key=' + key, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en-GB' } }, continuation: token }) });
    if (!r.ok) { log('cont ' + r.status); break; }
    token = collect(await r.json(), items, seen);
  }
  return items;
}
const out = {};
for (const h of ['EuropeanSpaceAgency', 'esaextras']) {
  const o = out[h] = {};
  try {
    const { html } = await page('https://www.youtube.com/@' + h + '/videos?hl=en-GB');
    const cid = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
    o.cid = cid; log(h, cid);
    for (const pre of ['UULF', 'UU']) { try { o.uploads = await all('https://www.youtube.com/playlist?list=' + pre + cid.slice(2) + '&hl=en-GB', h === 'esaextras' ? 60 : 1); o.pre = pre; break; } catch (e) { log('! ' + pre + ' ' + e.message); } }
    log(h, 'uploads', (o.uploads || []).length);
  } catch (e) { log('! ' + h + ' ' + e.message); }
  for (const q of ['ECSAT', 'Harwell', 'ESA UK', 'Roy Gibson']) {
    try { o['search_' + q] = await all('https://www.youtube.com/@' + h + '/search?query=' + q + '&hl=en-GB', 5); log(h, 'search', q, o['search_' + q].length); } catch (e) { log('! search ' + q + ' ' + e.message); }
  }
}
await writeFile('data/probe-ecsat.json', JSON.stringify(out, null, 1));
