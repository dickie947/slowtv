const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };
const id = 'PLZhRxE9191zPN4uc07ytohaXcS13qEgm2';
const r = await fetch('https://www.youtube.com/feeds/videos.xml?playlist_id=' + id, { headers: H });
const x = await r.text();
console.log('RSS', r.status, 'title', (x.match(/<title>([^<]*)/) || [])[1]);
for (const m of x.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)[\s\S]*?<title>([^<]*)[\s\S]*?<name>([^<]*)[\s\S]*?<published>([^<]+)/g)) console.log(m[4], m[1], m[3], '|', m[2].slice(0, 70));
const p = await (await fetch('https://www.youtube.com/playlist?list=' + id + '&hl=en-GB', { headers: H })).text();
const d = JSON.parse(p.match(/var ytInitialData = (\{.*?\});<\/script>/s)[1]);
function* walk(o) { if (Array.isArray(o)) { for (const y of o) yield* walk(y); } else if (o && typeof o === 'object') { yield o; for (const k in o) yield* walk(o[k]); } }
let n = 0;
for (const o of walk(d)) { const l = o.lockupViewModel; if (l) { n++; if (n <= 6) console.log('PAGE', l.contentId, JSON.stringify(l.metadata?.lockupMetadataViewModel?.title?.content), JSON.stringify(l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || '').slice(0, 200)); } }
console.log('pagetotal', n, d.metadata?.playlistMetadataRenderer?.title);
