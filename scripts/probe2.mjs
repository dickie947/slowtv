const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };
const id = 'PLE067A7397E1AF108';
function* walk(o) { if (Array.isArray(o)) { for (const x of o) yield* walk(x); } else if (o && typeof o === 'object') { yield o; for (const k in o) yield* walk(o[k]); } }
const r = await fetch('https://www.youtube.com/playlist?list=' + id + '&hl=en-GB', { headers: H });
const t = await r.text();
const m = t.match(/var ytInitialData = (\{.*?\});<\/script>/s);
console.log('regex match', !!m);
let data; try { data = JSON.parse(m[1]); } catch (e) { console.log('parse fail', e.message); }
const keys = {};
for (const o of walk(data)) for (const k of Object.keys(o)) if (/renderer|ViewModel|continuation/i.test(k)) keys[k] = (keys[k] || 0) + 1;
console.log(JSON.stringify(keys));
let n = 0;
for (const o of walk(data)) { if (o.playlistVideoRenderer && n++ < 2) console.log('PVR', JSON.stringify(o.playlistVideoRenderer).slice(0, 600)); }
n = 0;
for (const o of walk(data)) { if (o.lockupViewModel && n++ < 1) console.log('LVM', JSON.stringify(o.lockupViewModel).slice(0, 900)); }
console.log('title', data?.metadata?.playlistMetadataRenderer?.title);
