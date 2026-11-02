const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };
const id = 'PLE067A7397E1AF108';
const count = (s) => (s.match(/"videoId":"/g) || []).length;
let r = await fetch('https://www.youtube.com/playlist?list=' + id + '&hl=en-GB', { headers: H });
let t = await r.text();
console.log('PAGE', r.status, t.length, 'ytInitialData:', t.includes('ytInitialData'), 'videoIds:', count(t), 'consent:', /consent\.youtube|before you continue/i.test(t), 'bot:', /unusual traffic|captcha/i.test(t));
console.log(t.slice(0, 300).replace(/\s+/g, ' '));
const key = (t.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
console.log('key', key.slice(0, 8));
const clients = {
  WEB: { clientName: 'WEB', clientVersion: '2.20250101.00.00' },
  TV: { clientName: 'TVHTML5', clientVersion: '7.20250101.16.00' },
  ANDROID: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30 },
  IOS: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3' },
  MWEB: { clientName: 'MWEB', clientVersion: '2.20250101.00.00' },
};
for (const [n, c] of Object.entries(clients)) {
  try {
    const x = await fetch('https://www.youtube.com/youtubei/v1/browse?key=' + key, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { client: { ...c, hl: 'en-GB', gl: 'GB' } }, browseId: 'VL' + id }) });
    const s = await x.text();
    console.log(n, x.status, s.length, 'videoIds:', count(s), 'cont:', s.includes('continuationCommand'));
  } catch (e) { console.log(n, 'ERR', e.message); }
}
r = await fetch('https://www.youtube.com/feeds/videos.xml?playlist_id=' + id, { headers: H });
t = await r.text();
console.log('RSS', r.status, (t.match(/<entry>/g) || []).length, [...t.matchAll(/<yt:videoId>([^<]+)/g)].map((m) => m[1]).slice(0, 4).join(','));
